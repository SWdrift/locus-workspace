import { createServer } from 'node:http'

const port = Number(process.env.PORT ?? 3000)

const server = createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ ok: true }))
    return
  }
  response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
  response.end('hello from project-service\n')
})

server.listen(port, () => {
  console.log(`listening on http://127.0.0.1:${port}`)
})
