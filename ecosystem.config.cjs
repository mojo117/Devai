module.exports = {
  apps: [
    {
      name: "devai-dev",
      cwd: "/opt/Devai/apps/web",
      script: "npm",
      args: "run dev -- --port 3008 --host 0.0.0.0",
      env: {
        VITE_API_TARGET: "http://localhost:3009",
        VITE_PORT: "3008",
      },
    },
    {
      name: "devai-api-dev",
      cwd: "/opt/Devai/apps/api",
      script: "npm",
      args: "run dev",
      env: {
        PORT: "3009",
        HOST: "0.0.0.0",
      },
    },
  ],
};
