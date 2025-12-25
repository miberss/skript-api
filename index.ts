console.log("Starting server...");
console.log("PORT:", process.env.PORT || 3000);

const server = Bun.serve({
  port: process.env.PORT || 3000,
  async fetch(req) {
    console.log("Request:", req.url);
    const url = new URL(req.url);
    
    if (url.pathname === "/") {
      return new Response(Bun.file("./index.html"));
    }
    
    const filePath = `./public${url.pathname}`;
    const file = Bun.file(filePath);
    
    if (await file.exists()) {
      return new Response(file);
    }
    
    return new Response("Not Found", { status: 404 });
  }
});

console.log(`Server running on port ${server.port}`);
console.log("Server started successfully!");

// Keep process alive
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...');
  process.exit(0);
});