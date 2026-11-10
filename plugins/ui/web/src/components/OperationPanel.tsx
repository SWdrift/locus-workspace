import { useEffect, useState } from 'react'
import type {
  OperationAvailability,
  OperationDefinition,
  OperationInvocationResult,
} from '../types'
import { checkAvailability, invokeOperation } from '../api'
import CodeBlock from '../primitives/CodeBlock'
import DefinitionList from '../primitives/DefinitionList'
import Panel from '../primitives/Panel'
import StateBadge from '../primitives/StateBadge'
import { ErrorPanel, Loading } from '../primitives/States'
import styles from './OperationPanel.module.css'

interface SchemaObject {
  readonly type?: string
  readonly enum?: readonly string[]
  readonly description?: string
  readonly properties?: Readonly<Record<string, SchemaObject>>
  readonly required?: readonly string[]
}

type LoadingKind = 'availability' | 'invoke'

export default function OperationPanel({
  workspaceId,
  definitions,
  loading,
  error,
}: {
  readonly workspaceId: string
  readonly definitions: readonly OperationDefinition[] | undefined
  readonly loading: boolean
  readonly error: Error | undefined
}) {
  const [selectedId, setSelectedId] = useState<string>('')
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [confirm, setConfirm] = useState(false)
  const [availability, setAvailability] = useState<OperationAvailability | undefined>(undefined)
  const [availabilityError, setAvailabilityError] = useState<Error | undefined>(undefined)
  const [result, setResult] = useState<OperationInvocationResult | undefined>(undefined)
  const [invokeError, setInvokeError] = useState<Error | undefined>(undefined)
  const [loadingKind, setLoadingKind] = useState<LoadingKind | undefined>(undefined)

  const selected = definitions?.find((definition) => definition.id === selectedId) ?? definitions?.[0]

  useEffect(() => {
    if (selected !== undefined && selected.id !== selectedId) setSelectedId(selected.id)
  }, [selected, selectedId])

  const reset = (): void => {
    setInputs({})
    setConfirm(false)
    setAvailability(undefined)
    setAvailabilityError(undefined)
    setResult(undefined)
    setInvokeError(undefined)
  }

  const selectDefinition = (id: string): void => {
    setSelectedId(id)
    reset()
  }

  const onCheck = async (): Promise<void> => {
    if (selected === undefined) return
    setLoadingKind('availability')
    setAvailabilityError(undefined)
    try {
      setAvailability(await checkAvailability(selected.id, workspaceId))
    } catch (cause) {
      setAvailabilityError(cause instanceof Error ? cause : new Error(String(cause)))
    } finally {
      setLoadingKind(undefined)
    }
  }

  const onInvoke = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (selected === undefined) return
    if (selected.requiresConfirmation === true && !confirm) {
      setInvokeError(new Error('该操作需要先勾选外部环境确认。'))
      return
    }
    setLoadingKind('invoke')
    setInvokeError(undefined)
    setResult(undefined)
    try {
      const input: Record<string, unknown> = {}
      const schema = selected.input as SchemaObject
      for (const [name, property] of Object.entries(schema.properties ?? {})) {
        const value = inputs[name]
        if (value === undefined || value === '') continue
        input[name] = property.type === 'number' || property.type === 'integer' ? Number(value) : value
      }
      setResult(await invokeOperation(selected.id, input, workspaceId, confirm))
    } catch (cause) {
      setInvokeError(cause instanceof Error ? cause : new Error(String(cause)))
    } finally {
      setLoadingKind(undefined)
    }
  }

  if (loading && definitions === undefined) {
    return <Panel title="操作契约" meta={<span className={styles.tag}>Operation Catalog</span>}><Loading>读取 Operation Definition…</Loading></Panel>
  }
  if (error !== undefined && definitions === undefined) {
    return <Panel title="操作契约" meta={<span className={styles.tag}>Operation Catalog</span>}><ErrorPanel error={error} /></Panel>
  }
  if (selected === undefined) {
    return <Panel title="操作契约" meta={<span className={styles.tag}>Operation Catalog</span>}><p className={styles.muted}>没有可用的 Operation Definition。</p></Panel>
  }

  const schema = selected.input as SchemaObject
  const properties = Object.entries(schema.properties ?? {})
  const required = new Set(schema.required ?? [])

  return (
    <Panel
      title="操作契约"
      meta={<span className={styles.tag}>Operation Catalog</span>}
      description="UI 读取 Definition、输入 Schema 与 Availability，并调用当前 Provider；不复制领域实现。"
    >
      <div className={styles.toolbar}>
        <label className={styles.field}>
          <span>操作</span>
          <select value={selected.id} onChange={(event) => selectDefinition(event.target.value)}>
            {definitions?.map((definition) => (
              <option value={definition.id} key={definition.id}>
                {definition.id} · v{definition.version}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className={styles.button} onClick={() => void onCheck()} disabled={loadingKind !== undefined}>
          {loadingKind === 'availability' ? '检查中…' : '检查 Availability'}
        </button>
      </div>

      <DefinitionList items={[
        ['说明', selected.description],
        ['能力依赖', selected.capability === undefined ? '无' : `${selected.capability.id} (${selected.capability.provider})`],
        ['前置条件', selected.prerequisites?.join('；')],
        ['效果', selected.effects?.join('；')],
        ['Outcome', selected.outcome],
      ]} />

      {availabilityError === undefined ? null : <ErrorPanel error={availabilityError} />}
      {availability === undefined ? (
        <p className={styles.muted}>尚未检查 Availability。</p>
      ) : (
        <p className={styles.availability}>
          <StateBadge value={availability.state === 'available' ? 'available' : availability.code} />
          <span>{availability.state === 'available' ? '当前满足调用前置条件。' : availability.message}</span>
        </p>
      )}

      <form onSubmit={(event) => void onInvoke(event)}>
        <div className={styles.grid}>
          {properties.map(([name, property]) => (
            <label className={styles.field} key={name}>
              <span>{name}{required.has(name) ? ' *' : ''}</span>
              {Array.isArray(property.enum) ? (
                <select
                  value={inputs[name] ?? ''}
                  onChange={(event) => setInputs((current) => ({ ...current, [name]: event.target.value }))}
                >
                  <option value="">（未选择）</option>
                  {property.enum.map((option) => <option value={option} key={option}>{option}</option>)}
                </select>
              ) : (
                <input
                  type={property.type === 'number' || property.type === 'integer' ? 'number' : 'text'}
                  value={inputs[name] ?? ''}
                  placeholder={property.description ?? ''}
                  onChange={(event) => setInputs((current) => ({ ...current, [name]: event.target.value }))}
                />
              )}
            </label>
          ))}
        </div>

        {selected.requiresConfirmation === true ? (
          <label className={styles.confirm}>
            <input type="checkbox" checked={confirm} onChange={(event) => setConfirm(event.target.checked)} />
            我确认此操作会访问外部环境（只读），并遵守现有超时与主机密钥要求。
          </label>
        ) : null}

        <button type="submit" className={styles.primary} disabled={loadingKind !== undefined}>
          {loadingKind === 'invoke' ? '调用中…' : '调用操作'}
        </button>
      </form>

      {invokeError === undefined ? null : <ErrorPanel error={invokeError} />}
      {result === undefined ? null : result.ok ? (
        <div className={styles.result}>
          <div className={styles.resultHead}>
            <StateBadge value={typeof result.value === 'object' && result.value !== null && 'state' in result.value
              ? String((result.value as { state?: unknown }).state)
              : 'ok'} />
            <span className={styles.tag}>ok</span>
          </div>
          <CodeBlock>{JSON.stringify(result.value, null, 2)}</CodeBlock>
        </div>
      ) : (
        <div className={styles.result}>
          <div className={styles.resultHead}>
            <StateBadge value={result.error.code} />
            <span className={styles.tag}>调用错误</span>
          </div>
          <p className={styles.muted}>{result.error.message}</p>
          <CodeBlock>{JSON.stringify(result.error.details ?? [], null, 2)}</CodeBlock>
        </div>
      )}
    </Panel>
  )
}
