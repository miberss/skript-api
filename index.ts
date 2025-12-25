const server = Bun.serve({
  port: process.env.PORT || 3000,
  async fetch(req) {
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