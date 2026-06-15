import { spawn } from "child_process";
import path from "path";
import fs from "fs";

export function startDjango() {
  console.log("startDjango function called (run_backend.ts)");
  const backendDir = path.join(process.cwd(), "backend");

  // FIX: Single shared log stream, append mode
  const logPath = path.join(process.cwd(), "backend.log");
  const getLog = () => fs.createWriteStream(logPath, { flags: "a" });

  const runCommand = (cmd: string, args: string[]): Promise<number> => {
    const commandStr = `Running: ${cmd} ${args.join(" ")}`;
    console.log(commandStr);
    const logStream = getLog();
    logStream.write(`\n[${new Date().toISOString()}] ${commandStr}\n`);

    const proc = spawn(cmd, args, {
      cwd: backendDir,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });

    proc.stdout?.on("data", (d) => logStream.write(d));
    proc.stderr?.on("data", (d) => logStream.write(d));

    return new Promise<number>((resolve) => {
      proc.on("close", (code) => resolve(code ?? 0));
      proc.on("error", (err) => {
        console.error(`Failed to start ${cmd}:`, err);
        resolve(-1);
      });
    });
  };

  const cleanupExisting = async () => {
    // FIX: Only kill processes we own — do NOT use pkill -9 on the whole system.
    // pkill without -u will attempt to kill root-owned processes and print
    // "Operation not permitted" for every one of them, which floods the log.
    console.log("Cleaning up existing Django/Gunicorn processes on port 8001...");
    const logStream = getLog();
    logStream.write(`\n[${new Date().toISOString()}] Cleanup start\n`);

    const { execSync } = await import("child_process");
    const safeExec = (cmd: string) => {
      try {
        return execSync(cmd, { stdio: "pipe" }).toString();
      } catch {
        return ""; // non-zero exit is expected when nothing to kill
      }
    };

    if (process.platform === "win32") {
      safeExec("taskkill /F /IM python.exe /T");
    } else {
      // FIX: Kill only PIDs that belong to the current user
      const uid = process.getuid?.() ?? -1;
      if (uid >= 0) {
        // kill gunicorn workers owned by this user
        safeExec(`pkill -u ${uid} -f gunicorn || true`);
        safeExec(`pkill -u ${uid} -f 'manage.py' || true`);
      }
      // Release the port if anything is still holding it
      safeExec("fuser -k 8001/tcp 2>/dev/null || true");
    }

    logStream.write("Cleanup done\n");
  };

  const start = async () => {
    await cleanupExisting();

    // FIX: Prefer the venv python if the deploy script activated one.
    // process.env.VIRTUAL_ENV is set by `source .venv/bin/activate`.
    const pythonCmd = process.env.VIRTUAL_ENV
      ? path.join(process.env.VIRTUAL_ENV, "bin", "python")
      : "python3";

    console.log(`Using Python: ${pythonCmd}`);

    // Sanity-check pip
    const hasPip = await runCommand(pythonCmd, ["-m", "pip", "--version"]);
    if (hasPip !== 0) {
      const pipInstaller = path.join(backendDir, "install_pip.py");
      if (fs.existsSync(pipInstaller)) {
        await runCommand(pythonCmd, [pipInstaller]);
      } else {
        console.error("pip not found and install_pip.py is missing!");
      }
    }

    // Install requirements if Django is missing
    const hasDjango = await runCommand(pythonCmd, ["-c", "import django; print(django.get_version())"]);
    if (hasDjango !== 0) {
      console.log("Django not found — installing requirements...");
      await runCommand(pythonCmd, ["-m", "pip", "install", "-r", "requirements.txt"]);
    }

    // Ensure gunicorn
    const hasGunicorn = await runCommand(pythonCmd, ["-m", "gunicorn", "--version"]);
    if (hasGunicorn !== 0) {
      await runCommand(pythonCmd, ["-m", "pip", "install", "gunicorn"]);
    }

    // Migrations
    console.log("Running Django makemigrations...");
    await runCommand(pythonCmd, ["manage.py", "makemigrations", "--noinput"]);

    console.log("Running Django migrations...");
    const migrateCode = await runCommand(pythonCmd, ["manage.py", "migrate", "--noinput"]);
    console.log(`Migration exited with code ${migrateCode}`);

    // Seeds — wrap each in try/catch so one failure doesn't abort everything
    const seed = async (label: string, args: string[]) => {
      console.log(label);
      try {
        await runCommand(pythonCmd, args);
      } catch (e) {
        console.warn(`Seed warning (${label}):`, e);
      }
    };

    await seed("Running seeding scripts...", [
      "manage.py", "shell", "-c",
      "from seed_multi_tenant import seed_platform; from seed_users import create_users; seed_platform(); create_users();"
    ]);
    await seed("Running FixItAll seeding...", ["seed_fixitall.py"]);

    const logitechSeed = path.join(backendDir, "seed_logitech.py");
    if (fs.existsSync(logitechSeed)) {
      await seed("Running Logitech seeding...", ["seed_logitech.py"]);
    }

    // Start Gunicorn
    console.log("Starting Gunicorn server on 8001...");
    const logStream = getLog();
    logStream.write(`[${new Date().toISOString()}] Starting Gunicorn on 0.0.0.0:8001\n`);

    // FIX: Use the correct WSGI path — matches backend/fixitall_backend/wsgi.py
    const wsgiApp = "fixitall_backend.wsgi:application";

    const server = spawn(
      pythonCmd,
      [
        "-m", "gunicorn",
        wsgiApp,
        "--bind", "0.0.0.0:8001",
        "--workers", "3",
        "--timeout", "120",
        "--access-logfile", "-",
        "--error-logfile", "-",
      ],
      {
        cwd: backendDir,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
      }
    );

    server.stdout?.on("data", (d) => {
      process.stdout.write(`[GUNICORN STDOUT] ${d}`);
      logStream.write(d);
    });
    server.stderr?.on("data", (d) => {
      process.stderr.write(`[GUNICORN STDERR] ${d}`);
      logStream.write(d);
    });
    server.on("error", (err) => {
      console.error("Failed to start Gunicorn:", err);
      logStream.write(`Gunicorn error: ${err.message}\n`);
    });
    server.on("close", (code) => {
      console.log(`Gunicorn closed with code ${code}`);
      logStream.write(`Gunicorn closed with code ${code}\n`);
    });
  };

  start();
}