import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertConfigPath,
  ConfigReferenceFailure,
  isCredentialRef,
  parseCredentialRef,
  resolveCredentialRef,
} from '../lib/index.js'

test('解析并校验 credential:<id>，不接受路径、协议或通配', () => {
  assert.equal(parseCredentialRef('credential:postgres-local'), 'credential:postgres-local')
  assert.equal(isCredentialRef('credential:postgres-local'), true)
  for (const value of [
    'postgres-local',
    'credential:',
    'credential:Postgres',
    'credential:../secret',
    'credential:secret*',
    'file:/tmp/secret',
  ]) {
    assert.throws(() => parseCredentialRef(value), (error) => (
      error instanceof ConfigReferenceFailure && error.code === 'invalid-reference'
    ))
  }
})

test('从配置对象读取 credential，不读取文件或 Keyring', () => {
  assert.equal(resolveCredentialRef({ credential: 'credential:gitea-local' }), 'credential:gitea-local')
  assert.throws(() => resolveCredentialRef({}), ConfigReferenceFailure)
  assert.throws(() => resolveCredentialRef([]), ConfigReferenceFailure)
})

test('配置路径只允许安全的相对路径', () => {
  assert.equal(assertConfigPath('postgres/production.yaml'), 'postgres/production.yaml')
  for (const value of ['', ' /tmp/x', '/tmp/x', 'C:/secret', '../secret', 'postgres/../secret']) {
    assert.throws(() => assertConfigPath(value), ConfigReferenceFailure)
  }
})
