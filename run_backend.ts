import { spawn } from "child_process";
import path from "path";
import fs from "fs";

export function startDjango() {
  console.log("startDjango function called (run_backend.ts)");
  const backendDir = path.join(process.cwd(), "backend");
  
  const runCommand = (cmd: string, args: string[]) => {
    const commandStr = `Running: ${cmd} ${args.join(" ")}`;
    console.log(commandStr);
    const logStream = fs.createWriteStream(path.join(process.cwd(), 'backend.log'), { flags: 'a' });
    logStream.write(`\n[${new Date().toISOString()}] ${commandStr}\n`);
    const proc = spawn(cmd, args, {
      cwd: backendDir,
      stdio: ["ignore", "pipe", "pipe"],
    });

    if (proc.stdout) {
      proc.stdout.on('data', (data) => {
        logStream.write(data);
      });
    }
    if (proc.stderr) {
      proc.stderr.on('data', (data) => {
        logStream.write(data);
      });
    }

    return new Promise<number>((resolve) => {
      proc.on("close", (code) => {
        resolve(code || 0);
      });
      proc.on("error", (err) => {
        console.error(`Failed to start ${cmd}:`, err);
        resolve(-1);
      });
    });
  };

  const cleanupExisting = async () => {
    console.log("Cleaning up existing Django processes and port 8000...");
    const logStream = fs.createWriteStream(path.join(process.cwd(), 'backend.log'), { flags: 'a' });
    logStream.write(`\n[${new Date().toISOString()}] Cleaning up existing Django processes and port 8000...\n`);
    const { execSync } = await import('child_process');
    try {
      if (process.platform === "win32") {
        try {
          execSync('taskkill /F /IM python.exe /T');
          logStream.write("Windows taskkill success\n");
        } catch (e) { logStream.write(`Windows taskkill failed/none: ${e}\n`); }
      } else {
        // More aggressive cleanup on Linux
        try {
          // Kill processes by name
          const out = execSync("pkill -9 -f 'manage.py' || true").toString();
          logStream.write(`Linux pkill output: ${out}\n`);
        } catch (e) { logStream.write(`Linux pkill error: ${e}\n`); }
        try {
          // Kill anything listening on port 8001
          const out = execSync("fuser -k 8001/tcp || true").toString();
          logStream.write(`Linux fuser output: ${out}\n`);
        } catch (e) { logStream.write(`Linux fuser error/none: ${e}\n`); }
      }
    } catch (e) {
      logStream.write(`Overall cleanup error: ${e}\n`);
    }
  };

  const start = async () => {
    // Kill any existing instances first
    await cleanupExisting();
    const pythonCmd = "python3";
    
    console.log("Checking for pip...");
    const checkPip = await runCommand(pythonCmd, ["-m", "pip", "--version"]);
    if (checkPip !== 0) {
      console.log("pip not found. Attempting to install pip using install_pip.py...");
      const installPipPath = path.join(process.cwd(), "backend", "install_pip.py");
      if (fs.existsSync(installPipPath)) {
        await runCommand(pythonCmd, [installPipPath]);
      } else {
        console.error(`install_pip.py not found at ${installPipPath}!`);
      }
    }

    console.log("Checking for Django...");
    const checkDjango = await runCommand(pythonCmd, ["-c", "import django; print(django.get_version())"]);
    if (checkDjango !== 0) {
      console.log("Django not found. Installing requirements...");
      await runCommand(pythonCmd, ["-m", "pip", "install", "-r", "requirements.txt"]);
    }
    
    console.log("Running Django makemigrations...");
    await runCommand(pythonCmd, ["manage.py", "makemigrations", "--noinput"]);
    
    console.log("Running Django migrations...");
    const migrateCode = await runCommand(pythonCmd, ["manage.py", "migrate", "--noinput"]);
    console.log(`Migration exited with code ${migrateCode}`);

    // Seed database
    console.log("Running seeding scripts...");
    await runCommand(pythonCmd, ["manage.py", "shell", "-c", "from seed_multi_tenant import seed_platform; from seed_users import create_users; seed_platform(); create_users();"]);
    
    console.log("Running FixItAll custom seeding...");
    await runCommand(pythonCmd, ["seed_fixitall.py"]);
    
    // Run Logitech specific seed
    const logitechSeedPath = path.join(process.cwd(), "backend", "seed_logitech.py");
    if (fs.existsSync(logitechSeedPath)) {
      console.log("Running Logitech seeding script...");
      await runCommand(pythonCmd, ["seed_logitech.py"]);
    }

    console.log("Starting Django server on 8001...");
    const logStream = fs.createWriteStream(path.join(process.cwd(), 'backend.log'), { flags: 'a' });
    logStream.write(`[${new Date().toISOString()}] Attempting to start Django on 8001...\n`);
    
    const server = spawn(pythonCmd, ["-u", "manage.py", "runserver", "0.0.0.0:8001", "--noreload"], {
      cwd: backendDir,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PYTHONUNBUFFERED: "1" }
    });

    if (server.stdout) {
      server.stdout.on('data', (data) => {
        const out = data.toString();
        process.stdout.write(`[DJANGO STDOUT] ${out}`);
        logStream.write(out);
      });
    }
    if (server.stderr) {
      server.stderr.on('data', (data) => {
        const out = data.toString();
        process.stderr.write(`[DJANGO STDERR] ${out}`);
        logStream.write(out);
      });
    }

    server.on("error", (err) => {
      console.error("Failed to start Django server:", err);
      logStream.write(`Failed to start Django server: ${err.message}\n`);
    });
    
    server.on("close", (code) => {
        console.log(`Django server closed with code ${code}`);
        logStream.write(`Django server closed with code ${code}\n`);
    });
  };

  start();
}
