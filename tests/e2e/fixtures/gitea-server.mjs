import { createServer } from 'node:http'

const token = process.env.LOCUS_E2E_GITEA_TOKEN ?? 'e2e-gitea-token'
const repository = {
  id: 7,
  full_name: 'acme/repo',
  default_branch: 'main',
  private: true,
  archived: false,
  has_actions: true,
  html_url: 'http://gitea.example/acme/repo',
}

function json(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}

const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1')
  if (url.pathname === '/api/v1/version') return json(response, 200, { version: '1.25.5' })
  if (url.pathname === '/api/v1/user') {
    if (request.headers.authorization !== `token ${token}`) {
      return json(response, 401, { message: 'unauthorized' })
    }
    return json(response, 200, { login: 'acme' })
  }
  if (url.pathname === '/api/v1/repos/acme/repo') return json(response, 200, repository)
  if (url.pathname === '/api/v1/repositories/7') return json(response, 200, repository)
  if (url.pathname === '/api/v1/repos/acme/repo/actions/runs') {
    const sha = url.searchParams.get('head_sha') ?? 'a'.repeat(40)
    return json(response, 200, {
      total_count: 1,
      workflow_runs: [{
        id: 101,
        run_number: 12,
        display_title: 'E2E CI',
        event: 'push',
        status: 'completed',
        conclusion: 'success',
        head_sha: sha,
        head_branch: 'main',
      }],
    })
  }
  if (url.pathname === '/api/v1/repos/acme/repo/actions/runs/101') {
    return json(response, 200, {
      id: 101,
      run_number: 12,
      display_title: 'E2E CI',
      event: 'push',
      status: 'completed',
      conclusion: 'success',
      head_sha: 'a'.repeat(40),
      head_branch: 'main',
      path: 'ci.yaml@refs/heads/main',
      started_at: '2026-07-16T15:15:45+08:00',
      completed_at: '2026-07-16T15:16:19+08:00',
    })
  }
  json(response, 404, { message: 'not found' })
})

server.listen(0, '127.0.0.1', () => {
  const address = server.address()
  process.stdout.write(`READY ${address.port}\n`)
})

const close = () => server.close(() => process.exit(0))
process.once('SIGTERM', close)
process.once('SIGINT', close)
