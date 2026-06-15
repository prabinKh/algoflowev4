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

  // Removed cleanupExisting function and its call

  const start = async () => {
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

    // Ensure Gunicorn is installed
    console.log("Checking for Gunicorn...");
    const checkGunicorn = await runCommand(pythonCmd, ["-m", "gunicorn", "--version"]);
    if (checkGunicorn !== 0) {
      console.log("Gunicorn not found. Installing Gunicorn...");
      await runCommand(pythonCmd, ["-m", "pip", "install", "gunicorn"]);
    }
    
    // Removed Django makemigrations and migrate calls from here, they are handled by deploy-self-hosted.sh
    // Removed database seeding calls from here

    console.log("Starting Gunicorn server on 8001...");
    const logStream = fs.createWriteStream(path.join(process.cwd(), 'backend.log'), { flags: 'a' });
    logStream.write(`[${new Date().toISOString()}] Attempting to start Gunicorn on 8001...\n`);
    
    const wsgiApp = "fixitall_backend.wsgi:application";

    const server = spawn(pythonCmd, [
      "-m", "gunicorn",
      wsgiApp,
      "--bind", "0.0.0.0:8001",
      "--workers", "3",
      "--timeout", "120",
      "--access-logfile", "-",
      "--error-logfile", "-"
    ], {
      cwd: backendDir,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PYTHONUNBUFFERED: "1" }
    });

    if (server.stdout) {
      server.stdout.on('data', (data) => {
        const out = data.toString();
        process.stdout.write(`[GUNICORN STDOUT] ${out}`);
        logStream.write(out);
      });
    }
    if (server.stderr) {
      server.stderr.on('data', (data) => {
        const out = data.toString();
        process.stderr.write(`[GUNICORN STDERR] ${out}`);
        logStream.write(out);
      });
    }

    server.on("error", (err) => {
      console.error("Failed to start Gunicorn server:", err);
      logStream.write(`Failed to start Gunicorn server: ${err.message}\n`);
    });
    
    server.on("close", (code) => {
        console.log(`Gunicorn server closed with code ${code}`);
        logStream.write(`Gunicorn server closed with code ${code}\n`);
    });
  };

  start();
}