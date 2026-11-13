window.__ModuleLoader__.load({
  id: '@locus/dsh-surface',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var React = require('react')
    var primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    var h = React.createElement
    var ID = '@locus/dsh-surface'
    var PANEL_ID = 'locus'
    var embeddedSessionId

    function apiBase() {
      try {
        return new URL('locus/api', document.baseURI).toString().replace(/\/$/, '')
      } catch {
        return '/locus/api'
      }
    }

    function apiToken() {
      var meta = document.querySelector('meta[name="locus-api-token"]')
      return meta === null ? '' : meta.getAttribute('content') || ''
    }

    function apiHeaders(extra) {
      return Object.assign({
        accept: 'application/json',
        'x-locus-api-token': apiToken(),
      }, extra || {})
    }

    async function readResponse(response) {
      var body = await response.json().catch(function () { return {} })
      if (!response.ok) throw new Error(body.error || ('请求失败：' + response.status))
      return body
    }

    function apiGet(path, params, signal) {
      var query = new URLSearchParams(params || {}).toString()
      return fetch(apiBase() + path + (query === '' ? '' : '?' + query), {
        headers: apiHeaders(),
        signal: signal,
      }).then(readResponse)
    }

    function apiSend(path, method, body) {
      return fetch(apiBase() + path, {
        method: method,
        headers: apiHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify(body || {}),
      }).then(readResponse)
    }

    function keyOf(locationId, relativePath) {
      return relativePath === '' ? locationId : locationId + '/' + relativePath
    }

    function relativeOf(locationId, key) {
      return key === locationId ? '' : key.slice(locationId.length + 1)
    }

    function baseName(value) {
      var parts = value.split(/[\\/]/).filter(Boolean)
      return parts.length === 0 ? value : parts[parts.length - 1]
    }

    function fileAddress(sessionId, absolutePath) {
      var encoded = absolutePath.replace(/\\/g, '/').split('/').map(function (segment) {
        return encodeURIComponent(segment).replace(/%3A/gi, ':')
      }).join('/')
      return 'dsh-resource://file/session/' + encodeURIComponent(sessionId) + '/' + encoded
    }

    function parseLocusHash(hash) {
      var raw = typeof hash === 'string' && hash.charAt(0) === '#' ? hash.slice(1) : hash
      if (typeof raw !== 'string' || raw === '' || raw === '/') return null
      var question = raw.indexOf('?')
      var pathname = question === -1 ? raw : raw.slice(0, question)
      var search = question === -1 ? '' : raw.slice(question)
      if (pathname !== '/locus' && pathname.indexOf('/locus/') !== 0) return null
      var segments = pathname.slice('/locus'.length).split('/').filter(Boolean)
      var query = new URLSearchParams(search)
      function decode(value) {
        try {
          return decodeURIComponent(value)
        } catch {
          return undefined
        }
      }
      if (segments.length === 0) {
        return { kind: 'workspaces' }
      }
      if (segments[0] === 'sessions' && segments.length >= 2) {
        var sessionId = decode(segments[1])
        if (sessionId === undefined) return { kind: 'unknown' }
        if (segments.length <= 3) {
          return { kind: 'session', sessionId: sessionId, view: query.get('view') || undefined }
        }
        return { kind: 'unknown' }
      }
      if (segments[0] === 'workspaces') {
        if (segments.length === 1) return { kind: 'workspaces' }
        if (segments.length >= 2) {
          var workspaceId = decode(segments[1])
          if (workspaceId === undefined) return { kind: 'unknown' }
          if (segments.length === 2) {
            return { kind: 'overview', workspaceId: workspaceId, locationId: query.get('location') || undefined }
          }
          if (segments.length === 3 && segments[2] === 'files') {
            return { kind: 'files', workspaceId: workspaceId, locationId: query.get('location') || undefined }
          }
        }
      }
      return { kind: 'unknown' }
    }

    function locusHash(route) {
      if (route.kind === 'session') {
        var hash = route.sessionId === undefined
          ? '#/locus'
          : '#/locus/sessions/' + encodeURIComponent(route.sessionId)
        return route.view === undefined ? hash : hash + '?view=' + encodeURIComponent(route.view)
      }
      if (route.kind === 'workspaces') return '#/locus/workspaces'
      if (route.kind === 'overview') {
        return '#/locus/workspaces/' + encodeURIComponent(route.workspaceId)
      }
      if (route.kind === 'files') {
        var fileHash = '#/locus/workspaces/' + encodeURIComponent(route.workspaceId) + '/files'
        return route.locationId === undefined ? fileHash : fileHash + '?location=' + encodeURIComponent(route.locationId)
      }
      return '#/locus'
    }

    function hashTargetsLocus(hash) {
      var route = parseLocusHash(hash)
      return route !== null
    }

    function useLocusRoute() {
      var state = React.useState(function () { return parseLocusHash(window.location.hash) })
      var route = state[0]
      var setRoute = state[1]
      React.useEffect(function () {
        function sync() { setRoute(parseLocusHash(window.location.hash)) }
        window.addEventListener('hashchange', sync)
        return function () { window.removeEventListener('hashchange', sync) }
      }, [])
      var navigate = React.useCallback(function (next) {
        var hash = locusHash(next)
        if (window.location.hash !== hash) window.location.hash = hash
      }, [])
      var replace = React.useCallback(function (next) {
        var hash = locusHash(next)
        if (window.location.hash === hash) return
        window.history.replaceState(null, '', hash)
        setRoute(parseLocusHash(hash))
      }, [])
      return { route: route, navigate: navigate, replace: replace }
    }

    var mono = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
    var noteStyle = {
      color: 'var(--dsw-alias-label-secondary, inherit)',
      fontSize: '12px',
      lineHeight: '1.6',
      margin: 0,
    }
    var buttonStyle = {
      border: '0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2))',
      borderRadius: '8px',
      background: 'transparent',
      color: 'var(--dsw-alias-label-primary, inherit)',
      cursor: 'pointer',
      font: 'inherit',
      fontSize: '12px',
      padding: '5px 10px',
    }
    var inputStyle = {
      background: 'transparent',
      border: '0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2))',
      borderRadius: '8px',
      boxSizing: 'border-box',
      color: 'var(--dsw-alias-label-primary, inherit)',
      font: 'inherit',
      fontSize: '12px',
      minWidth: 0,
      padding: '6px 8px',
      width: '100%',
    }

    function errorText(cause) {
      return cause instanceof Error ? cause.message : String(cause)
    }

    function associationOf(items, dshWorkspaceId) {
      if (dshWorkspaceId === undefined) return undefined
      for (var index = 0; index < items.length; index += 1) {
        if (items[index].dshWorkspaceId === dshWorkspaceId) return items[index]
      }
      return undefined
    }

    function useLocusData() {
      var state = React.useState({ loading: true, workspaces: [] })
      var view = state[0]
      var setView = state[1]
      var revisionState = React.useState(0)
      var revision = revisionState[0]
      var setRevision = revisionState[1]

      React.useEffect(function () {
        var controller = new AbortController()
        setView(function (previous) { return Object.assign({}, previous, { loading: true, error: undefined }) })
        apiGet('/locations', {}, controller.signal).then(function (result) {
          setView({ loading: false, workspaces: result.workspaces || [] })
        }).catch(function (error) {
          if (error.name !== 'AbortError') {
            setView({ loading: false, workspaces: [], error: error.message })
          }
        })
        return function () { controller.abort() }
      }, [revision])

      React.useEffect(function () {
        function changed() { setRevision(function (value) { return value + 1 }) }
        window.addEventListener('locus:data-changed', changed)
        return function () { window.removeEventListener('locus:data-changed', changed) }
      }, [])

      return {
        loading: view.loading,
        error: view.error,
        workspaces: view.workspaces || [],
        revision: revision,
        reload: function () { setRevision(function (value) { return value + 1 }) },
      }
    }

    function TreeSection(props) {
      var location = props.location
      var workspaceId = props.workspaceId
      var renderFileTree = props.renderFileTree
      var openResource = props.openResource
      var sessionId = props.sessionId
      var root = location.id
      var levelsState = React.useState({})
      var levels = levelsState[0]
      var setLevels = levelsState[1]
      var expandedState = React.useState([root])
      var expanded = expandedState[0]
      var setExpanded = expandedState[1]
      var inflight = React.useRef(new Set())
      var loaded = React.useRef(new Set())

      var fill = React.useCallback(function (relativePath) {
        var key = keyOf(root, relativePath)
        if (inflight.current.has(key) || loaded.current.has(key)) return
        inflight.current.add(key)
        setLevels(function (previous) {
          var next = Object.assign({}, previous)
          next[key] = { loading: true, entries: previous[key] ? previous[key].entries : [] }
          return next
        })
        apiGet('/list', {
          workspaceId: workspaceId,
          locationId: location.id,
          relativePath: relativePath,
        }).then(function (result) {
          loaded.current.add(key)
          setLevels(function (previous) {
            var next = Object.assign({}, previous)
            next[key] = { entries: result.entries, truncated: result.truncated }
            return next
          })
        }).catch(function (error) {
          setLevels(function (previous) {
            var next = Object.assign({}, previous)
            next[key] = {
              entries: previous[key] ? previous[key].entries : [],
              failure: error.message,
            }
            return next
          })
        }).finally(function () {
          inflight.current.delete(key)
        })
      }, [root, workspaceId, location.id])

      React.useEffect(function () { fill('') }, [fill])

      var entries = []
      Object.keys(levels).forEach(function (key) {
        var level = levels[key]
        ;(level.entries || []).forEach(function (entry) {
          entries.push({
            path: keyOf(root, entry.relativePath),
            name: entry.name,
            meta: {
              kind: entry.kind === 'directory' ? 'directory' : entry.kind === 'file' ? 'file' : 'other',
            },
          })
        })
      })
      entries.sort(function (left, right) {
        var leftDirectory = left.meta.kind === 'directory'
        var rightDirectory = right.meta.kind === 'directory'
        if (leftDirectory !== rightDirectory) return leftDirectory ? -1 : 1
        return left.name.localeCompare(right.name)
      })

      var directories = {}
      Object.keys(levels).forEach(function (key) {
        var level = levels[key]
        var state = {}
        if (level.loading === true) state.loading = true
        if (level.failure !== undefined) state.failure = level.failure
        if (level.truncated === true) state.truncated = true
        directories[key] = state
      })

      var rootFailure = levels[root] && levels[root].failure

      return h('section', { style: { minHeight: 0, padding: '8px 0' }, 'data-locus-location': location.id },
        h('div', {
          style: {
            color: 'var(--dsw-alias-label-secondary, inherit)',
            fontFamily: mono,
            fontSize: '11px',
            overflow: 'hidden',
            padding: '0 10px 6px',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          },
          title: location.path,
        }, location.path),
        rootFailure === undefined ? null : h('p', {
          style: Object.assign({}, noteStyle, { color: 'var(--dsw-alias-state-error-primary, inherit)', padding: '4px 10px' }),
        }, rootFailure),
        renderFileTree === undefined ? h('p', { style: Object.assign({}, noteStyle, { padding: '8px 10px' }) }, '文件树不可用') : renderFileTree({
          root: root,
          entries: entries,
          expanded: expanded,
          directories: directories,
          onToggle: function (entry, open) {
            var key = entry.path
            if (open) {
              setExpanded(function (previous) {
                return previous.indexOf(key) === -1 ? previous.concat(key) : previous
              })
              fill(relativeOf(root, key))
              return
            }
            setExpanded(function (previous) {
              return previous.filter(function (item) { return item !== key && item.indexOf(key + '/') !== 0 })
            })
          },
          onOpen: function (entry) {
            var relativePath = relativeOf(root, entry.path)
            var absolute = location.path.replace(/[\\/]+$/, '') + '/' + relativePath
            if (props.onOpenPath !== undefined) {
              props.onOpenPath({ name: entry.name, relativePath: relativePath, absolutePath: absolute })
              return
            }
            if (openResource === undefined || sessionId === undefined) return
            openResource(fileAddress(sessionId, absolute))
          },
          canOpen: function (entry) {
            return (props.onOpenPath !== undefined || (openResource !== undefined && sessionId !== undefined)) &&
              entry.meta !== undefined && entry.meta.kind === 'file'
          },
        })
      )
    }

    function useAssociations() {
      var state = React.useState({ loading: true, items: [] })
      var value = state[0]
      var setValue = state[1]
      React.useEffect(function () {
        var active = true
        function load() {
          apiGet('/associations', {}).then(function (result) {
            if (active) setValue({ loading: false, items: result.associations || [] })
          }).catch(function (error) {
            if (active) setValue({ loading: false, items: [], error: error.message })
          })
        }
        load()
        function changed() { load() }
        window.addEventListener('locus:associations-changed', changed)
        return function () {
          active = false
          window.removeEventListener('locus:associations-changed', changed)
        }
      }, [])
      return value
    }

    function useHostCapabilities() {
      var state = React.useState({ loading: true })
      var value = state[0]
      var setValue = state[1]
      React.useEffect(function () {
        var active = true
        apiGet('/capabilities', {}).then(function (result) {
          if (active) setValue({ loading: false, value: result })
        }).catch(function (error) {
          if (active) setValue({ loading: false, error: errorText(error) })
        })
        return function () { active = false }
      }, [])
      return value
    }

    function hostErrorText(cause) {
      var text = errorText(cause)
      return text === '路径不存在'
        ? '当前 DSH Host 未加载最新 Locus API；请重启 DSH 进程后重试。'
        : text
    }

    function useDshState(ctx) {
      var state = React.useState(function () {
        return {
          sessions: ctx.sessions.list.getSnapshot(),
          workspaces: ctx.workspaces.list.getSnapshot(),
        }
      })
      var value = state[0]
      var setValue = state[1]
      React.useEffect(function () {
        function update() {
          setValue({
            sessions: ctx.sessions.list.getSnapshot(),
            workspaces: ctx.workspaces.list.getSnapshot(),
          })
        }
        update()
        var disposeSessions = ctx.sessions.list.subscribe(update)
        var disposeWorkspaces = ctx.workspaces.list.subscribe(update)
        return function () {
          disposeSessions()
          disposeWorkspaces()
        }
      }, [])
      return value
    }

    function readDshViews(ctx) {
      return ctx.slots.entriesOfSlot('conversation.view').map(function (entry) {
        var options = entry.options || {}
        var label = typeof options.label === 'function' ? options.label() : options.label
        return {
          id: options.id,
          label: typeof label === 'string' && label !== '' ? label : options.id,
          order: typeof options.order === 'number' ? options.order : 0,
        }
      }).filter(function (view) {
        return typeof view.id === 'string' && view.id !== ''
      }).sort(function (left, right) {
        return left.order - right.order
      })
    }

    function useDshViews(ctx) {
      var state = React.useState(function () { return readDshViews(ctx) })
      var views = state[0]
      var setViews = state[1]
      React.useEffect(function () {
        function update() { setViews(readDshViews(ctx)) }
        update()
        return ctx.slots.subscribe('conversation.view', update)
      }, [])
      return views
    }

    function LocusIcon(props) {
      var size = props.size === undefined ? 20 : props.size
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.5,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
      },
        h('rect', { x: 3.5, y: 3.5, width: 17, height: 17, rx: 4.5 }),
        h('path', { d: 'M3.5 9.5h17M9.5 9.5v11' })
      )
    }

    function readLastSession() {
      try {
        return window.localStorage.getItem('locus.lastSessionId') || undefined
      } catch {
        return undefined
      }
    }

    function writeLastSession(sessionId) {
      try {
        window.localStorage.setItem('locus.lastSessionId', sessionId)
      } catch {
        /* private mode or storage disabled */
      }
    }

    function readDshCurrentSession() {
      try {
        var value = JSON.parse(window.localStorage.getItem('dsh.sessions.current') || 'null')
        return value !== null && typeof value === 'object' && typeof value.sessionId === 'string'
          ? value.sessionId
          : undefined
      } catch {
        return undefined
      }
    }

    function readDshContext() {
      try {
        var value = JSON.parse(window.localStorage.getItem('locus.dshContext') || 'null')
        if (value === null || typeof value !== 'object') return undefined
        return value
      } catch {
        return undefined
      }
    }

    function writeDshContext(context) {
      try {
        window.localStorage.setItem('locus.dshContext', JSON.stringify(context))
      } catch {
        /* private mode or storage disabled */
      }
    }

    function WorkspaceSelect(props) {
      var state = React.useState(false)
      var open = state[0]
      var setOpen = state[1]
      var rootRef = React.useRef(null)
      React.useEffect(function () {
        if (!open) return
        function onPointerDown(event) {
          if (rootRef.current !== null && !rootRef.current.contains(event.target)) setOpen(false)
        }
        document.addEventListener('pointerdown', onPointerDown)
        return function () { document.removeEventListener('pointerdown', onPointerDown) }
      }, [open])
      var current
      for (var index = 0; index < props.options.length; index += 1) {
        if (props.options[index].value === props.value) {
          current = props.options[index]
          break
        }
      }
      var label = current === undefined ? props.placeholder : current.label
      var triggerStyle = {
        alignItems: 'center',
        background: 'transparent',
        border: '0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2))',
        borderRadius: '7px',
        color: 'var(--dsw-alias-label-primary, inherit)',
        cursor: 'pointer',
        display: 'inline-flex',
        font: 'inherit',
        fontSize: '11px',
        gap: '4px',
        height: '24px',
        maxWidth: '170px',
        padding: '1px 6px',
      }
      var menuStyle = {
        background: 'var(--dsw-alias-bg-layer-1, white)',
        border: '0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2))',
        borderRadius: '9px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.16)',
        display: 'grid',
        gap: '2px',
        left: 0,
        minWidth: '100%',
        padding: '4px',
        position: 'absolute',
        top: 'calc(100% + 4px)',
        zIndex: 230,
      }
      var optionStyle = {
        background: 'transparent',
        border: 'none',
        borderRadius: '6px',
        color: 'var(--dsw-alias-label-primary, inherit)',
        cursor: 'pointer',
        font: 'inherit',
        fontSize: '12px',
        maxWidth: '240px',
        overflow: 'hidden',
        padding: '5px 8px',
        textAlign: 'left',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        width: '100%',
      }
      return h('div', {
        ref: rootRef,
        style: { alignItems: 'center', display: 'flex', gap: '4px', minWidth: 0, position: 'relative' },
      },
        h('span', { style: { color: 'var(--dsw-alias-label-tertiary, inherit)', flex: 'none', fontSize: '10px' } }, props.label),
        h('button', {
          type: 'button',
          title: label,
          'aria-haspopup': 'listbox',
          'aria-expanded': open,
          onClick: function () { setOpen(function (value) { return !value }) },
          style: triggerStyle,
        },
          h('span', { style: { maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, label),
          h('span', { style: { fontSize: '9px' } }, '▾')
        ),
        open ? h('div', { role: 'listbox', style: menuStyle }, props.options.map(function (option) {
          var selected = option.value === props.value
          return h('button', {
            key: option.value,
            type: 'button',
            role: 'option',
            'aria-selected': selected,
            onClick: function () {
              setOpen(false)
              if (!selected) props.onChange(option.value)
            },
            style: Object.assign({}, optionStyle, selected
              ? { background: 'var(--dsw-alias-interactive-bg-active, rgba(128,128,128,0.16))' }
              : {}),
          }, option.label)
        })) : null
      )
    }

    function SessionSelect(props) {
      var state = React.useState(false)
      var open = state[0]
      var setOpen = state[1]
      var rootRef = React.useRef(null)
      React.useEffect(function () {
        if (!open) return
        function onPointerDown(event) {
          if (rootRef.current !== null && !rootRef.current.contains(event.target)) setOpen(false)
        }
        document.addEventListener('pointerdown', onPointerDown)
        return function () { document.removeEventListener('pointerdown', onPointerDown) }
      }, [open])
      var options = props.options || []
      if (options.length === 0) return null
      var current = options.find(function (option) { return option.value === props.value }) || options[0]
      return h('div', { ref: rootRef, style: { position: 'relative' } },
        h('button', {
          type: 'button',
          title: 'DSH 会话',
          'aria-haspopup': 'listbox',
          'aria-expanded': open,
          onClick: function () { setOpen(function (value) { return !value }) },
          style: {
            alignItems: 'center',
            background: 'var(--dsw-alias-fill-tsp-secondary, rgba(128,128,128,0.1))',
            border: 'none',
            borderRadius: 'var(--dsw-radius-xs, 6px)',
            color: 'var(--dsw-alias-label-tertiary, inherit)',
            cursor: 'pointer',
            display: 'inline-flex',
            font: 'inherit',
            fontSize: '12px',
            gap: '4px',
            height: '22px',
            lineHeight: '22px',
            maxWidth: '180px',
            padding: '0 6px',
          },
        },
          h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, current.label),
          h('span', { style: { fontSize: '9px' } }, '▾')
        ),
        open ? h('div', {
          role: 'listbox',
          style: {
            background: 'var(--dsw-alias-bg-layer-1, white)',
            border: '0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2))',
            borderRadius: '9px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.16)',
            display: 'grid',
            gap: '2px',
            left: 0,
            maxHeight: '240px',
            minWidth: '180px',
            overflow: 'auto',
            padding: '4px',
            position: 'absolute',
            top: 'calc(100% + 4px)',
            zIndex: 230,
          },
        }, options.map(function (option) {
          var selected = option.value === props.value
          return h('button', {
            key: option.value,
            type: 'button',
            role: 'option',
            'aria-selected': selected,
            onClick: function () {
              setOpen(false)
              props.onChange(option.value)
            },
            style: {
              background: selected ? 'var(--dsw-alias-interactive-bg-active, rgba(128,128,128,0.16))' : 'transparent',
              border: 'none',
              borderRadius: '6px',
              color: 'var(--dsw-alias-label-primary, inherit)',
              cursor: 'pointer',
              font: 'inherit',
              fontSize: '12px',
              overflow: 'hidden',
              padding: '5px 8px',
              textAlign: 'left',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            },
          }, option.label)
        })) : null
      )
    }

    function Overview(props) {
      var workspace = props.workspace
      var card = {
        background: 'var(--dsw-alias-fill-tsp-secondary, rgba(128,128,128,0.06))',
        border: '0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2))',
        borderRadius: '10px',
        padding: '12px 14px',
      }
      return h('div', { style: { display: 'grid', gap: '16px', overflow: 'auto', padding: '20px 24px 32px' } },
        h('div', { style: { display: 'grid', gap: '10px', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' } },
          h('div', { style: card },
            h('p', { style: Object.assign({}, noteStyle, { fontSize: '11px', marginBottom: '3px' }) }, 'Workspace'),
            h('div', { style: { fontSize: '15px', fontWeight: 600 } }, workspace.name)
          ),
          h('div', { style: card },
            h('p', { style: Object.assign({}, noteStyle, { fontSize: '11px', marginBottom: '3px' }) }, '身份'),
            h('div', { style: { fontFamily: mono, fontSize: '10px', overflowWrap: 'anywhere' } }, workspace.id)
          ),
          h('div', { style: card },
            h('p', { style: Object.assign({}, noteStyle, { fontSize: '11px', marginBottom: '3px' }) }, '位置'),
            h('div', { style: { fontSize: '15px', fontWeight: 600 } }, String(workspace.locations.length))
          ),
          h('div', { style: card },
            h('p', { style: Object.assign({}, noteStyle, { fontSize: '11px', marginBottom: '3px' }) }, '长期关系'),
            h('div', { style: { fontSize: '15px', fontWeight: 600 } }, String(workspace.relationCount === undefined ? 0 : workspace.relationCount))
          )
        ),
        h('section', null,
          h('div', { style: { alignItems: 'center', display: 'flex', gap: '10px', justifyContent: 'space-between', marginBottom: '8px' } },
            h('div', { style: { fontSize: '13px', fontWeight: 600 } }, '位置'),
            h('div', { style: { display: 'flex', gap: '6px' } },
              props.onOpenFiles === undefined ? null : h('button', { type: 'button', style: buttonStyle, onClick: function () { props.onOpenFiles() } }, '浏览文件')
            )
          ),
          workspace.locations.length === 0
            ? h('p', { style: noteStyle }, '尚未登记位置。在「工作区」tab 中添加绝对路径。')
            : h('div', { style: { display: 'grid', gap: '6px' } }, workspace.locations.map(function (location) {
              return h('div', {
                key: location.id,
                style: {
                  alignItems: 'center',
                  border: '0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2))',
                  borderRadius: '8px',
                  display: 'flex',
                  gap: '8px',
                  padding: '7px 9px',
                },
              },
                h('span', { style: { flex: '1 1 auto', fontFamily: mono, fontSize: '11px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: location.path }, location.path),
                props.onOpenFiles === undefined ? null : h('button', {
                  type: 'button',
                  style: Object.assign({}, buttonStyle, { flex: 'none', fontSize: '11px', padding: '3px 7px' }),
                  onClick: function () { props.onOpenFiles(location.id) },
                }, '浏览')
              )
            }))
        )
      )
    }

    function FilesView(props) {
      var workspace = props.workspace
      var selectedLocationId = props.selectedLocationId
      var dshLocation = props.dshWorkspacePath === undefined
        ? undefined
        : workspace.locations.find(function (location) { return location.path === props.dshWorkspacePath })
      var selected = workspace.locations.find(function (location) { return location.id === selectedLocationId }) || dshLocation || workspace.locations[0]

      if (workspace.locations.length === 0) {
        return h('div', { style: { padding: '20px 24px' } },
          h('p', { style: noteStyle }, '该 Workspace 尚未登记位置。在「工作区」tab 中添加位置后再浏览。'))
      }

      return h('div', { style: { display: 'flex', flex: '1 1 auto', minHeight: 0, overflow: 'hidden' } },
        h('div', {
          style: {
            borderRight: '0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2))',
            flex: 'none',
            overflow: 'auto',
            padding: '10px 8px',
            width: '250px',
          },
        },
          h('div', { style: Object.assign({}, noteStyle, { fontSize: '11px', padding: '4px 8px 8px' }) }, '位置'),
          workspace.locations.map(function (location) {
            var active = selected !== undefined && selected.id === location.id
            return h('button', {
              key: location.id,
              type: 'button',
              onClick: function () { props.onSelectLocation(location.id) },
              title: location.path,
              style: {
                background: active ? 'var(--dsw-alias-interactive-bg-active, rgba(128,128,128,0.16))' : 'transparent',
                border: 'none',
                borderRadius: '8px',
                color: 'var(--dsw-alias-label-primary, inherit)',
                cursor: 'pointer',
                display: 'block',
                font: 'inherit',
                marginBottom: '2px',
                padding: '8px',
                textAlign: 'left',
                width: '100%',
              },
            },
              h('div', { style: { fontSize: '13px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, baseName(location.path)),
              h('div', { style: Object.assign({}, noteStyle, { fontFamily: mono, fontSize: '10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }) }, location.path),
              props.dshWorkspacePath === location.path ? h('span', {
                style: { color: 'var(--dsw-alias-state-business-primary, inherit)', fontSize: '10px' },
              }, 'DSH 工作区') : null
            )
          })
        ),
        h('div', { style: { display: 'flex', flex: '1 1 auto', flexDirection: 'column', minWidth: 0 } },
          selected === undefined ? null : h('div', { style: { padding: '12px 16px 0' } },
            h('div', { style: { fontSize: '13px', fontWeight: 600 } }, baseName(selected.path)),
            h('div', { style: Object.assign({}, noteStyle, { fontFamily: mono, fontSize: '11px', overflowWrap: 'anywhere' }) }, selected.path)
          ),
          h('div', { style: { flex: '1 1 auto', minHeight: 0, overflow: 'auto', padding: '4px 8px 18px' } },
            selected === undefined ? null : h(TreeSection, {
              key: workspace.id + '/' + selected.id,
              workspaceId: workspace.id,
              location: selected,
              renderFileTree: props.renderFileTree,
              openResource: props.openResource,
              sessionId: props.sessionId,
            })
          )
        )
      )
    }

    function LocusFilePane(props) {
      var workspace = props.workspace
      var location = props.location
      var previewState = React.useState(undefined)
      var preview = previewState[0]
      var setPreview = previewState[1]
      var tabsState = React.useState([])
      var tabs = tabsState[0]
      var setTabs = tabsState[1]
      var readState = React.useState({ loading: false })
      var read = readState[0]
      var setRead = readState[1]

      React.useEffect(function () {
        setPreview(undefined)
        setTabs([])
      }, [location === undefined ? undefined : location.id])

      React.useEffect(function () {
        if (preview === undefined || location === undefined || workspace === undefined) return
        var controller = new AbortController()
        setRead({ loading: true })
        apiGet('/read', {
          workspaceId: workspace.id,
          locationId: location.id,
          relativePath: preview.relativePath,
        }, controller.signal).then(function (result) {
          setRead({ loading: false, text: result.text, truncated: result.truncated, kind: result.resource === undefined ? undefined : result.resource.kind })
        }).catch(function (error) {
          if (error.name !== 'AbortError') setRead({ loading: false, error: errorText(error) })
        })
        return function () { controller.abort() }
      }, [preview, location === undefined ? undefined : location.id, workspace === undefined ? undefined : workspace.id])

      function openFile(file) {
        setTabs(function (previous) {
          if (previous.some(function (item) { return item.relativePath === file.relativePath })) return previous
          return previous.concat(file)
        })
        setPreview(file)
      }

      function closeFileTab(file) {
        setTabs(function (previous) {
          return previous.filter(function (item) { return item.relativePath !== file.relativePath })
        })
        if (preview !== undefined && preview.relativePath === file.relativePath) setPreview(undefined)
      }

      if (workspace === undefined) {
        return h('aside', { style: { borderLeft: '0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2))', flex: 'none', padding: '14px', width: '320px' } },
          h('p', { style: noteStyle }, '没有活跃 Workspace。'))
      }
      return h('aside', {
        style: {
          borderLeft: '0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2))',
          display: 'flex',
          flex: 'none',
          flexDirection: 'column',
          minHeight: 0,
          width: '320px',
        },
      },
        h('div', {
          style: {
            borderBottom: '0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2))',
            flex: 'none',
            minWidth: 0,
            padding: '8px 10px 0',
          },
        },
          h('div', {
            style: { alignItems: 'center', display: 'flex', gap: '8px', justifyContent: 'space-between', padding: '0 2px 6px' },
          },
            h('div', { style: { minWidth: 0 } },
              h('div', { style: { fontSize: '12px', fontWeight: 600 } }, '文件'),
              h('div', {
                style: Object.assign({}, noteStyle, { fontFamily: mono, fontSize: '10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }),
                title: preview === undefined
                  ? (location === undefined ? workspace.name : location.path)
                  : location.path.replace(/[\\/]+$/, '') + '/' + preview.relativePath,
              }, preview === undefined
                ? (location === undefined ? workspace.name : location.path)
                : preview.relativePath)
            ),
            h('button', {
              type: 'button',
              title: '关闭文件树',
              'aria-label': '关闭文件树',
              onClick: props.onClose,
              style: Object.assign({}, buttonStyle, { border: 'none', fontSize: '16px', lineHeight: '18px', padding: '1px 5px' }),
            }, '×')
          ),
          h('div', {
            role: 'tablist',
            style: { display: 'flex', gap: '2px', overflowX: 'auto', overflowY: 'hidden', paddingBottom: '1px' },
          },
            h('div', {
              role: 'tab',
              'aria-selected': preview === undefined,
              onClick: function () { setPreview(undefined) },
              style: {
                borderBottom: preview === undefined ? '2px solid var(--dsw-alias-state-business-primary, #4d6bfe)' : '2px solid transparent',
                color: preview === undefined ? 'var(--dsw-alias-label-primary, inherit)' : 'var(--dsw-alias-label-tertiary, inherit)',
                cursor: 'pointer',
                flex: 'none',
                fontSize: '11px',
                lineHeight: '18px',
                padding: '4px 7px',
                whiteSpace: 'nowrap',
              },
            }, '文件'),
            tabs.map(function (file) {
              var active = preview !== undefined && preview.relativePath === file.relativePath
              return h('div', {
                key: file.relativePath,
                role: 'tab',
                'aria-selected': active,
                onClick: function () { setPreview(file) },
                style: {
                  alignItems: 'center',
                  borderBottom: active ? '2px solid var(--dsw-alias-state-business-primary, #4d6bfe)' : '2px solid transparent',
                  color: active ? 'var(--dsw-alias-label-primary, inherit)' : 'var(--dsw-alias-label-tertiary, inherit)',
                  cursor: 'pointer',
                  display: 'flex',
                  flex: 'none',
                  fontSize: '11px',
                  gap: '2px',
                  lineHeight: '18px',
                  maxWidth: '150px',
                  padding: '4px 4px 4px 7px',
                  whiteSpace: 'nowrap',
                },
              },
                h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, file.name),
                h('button', {
                  type: 'button',
                  title: '关闭',
                  'aria-label': '关闭 ' + file.name,
                  onClick: function (event) {
                    event.stopPropagation()
                    closeFileTab(file)
                  },
                  style: { background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '11px', lineHeight: '12px', padding: '0 2px' },
                }, '×')
              )
            })
          )
        ),
        preview !== undefined
          ? h('div', { style: { flex: '1 1 auto', minHeight: 0, overflow: 'auto' } },
            read.loading ? h('p', { style: Object.assign({}, noteStyle, { padding: '12px' }) }, '正在读取文件…')
              : read.error !== undefined ? h('p', { style: Object.assign({}, noteStyle, { color: 'var(--dsw-alias-state-error-primary, inherit)', padding: '12px' }) }, read.error)
                : h('div', { style: { padding: '8px 10px 14px' } },
                  preview.relativePath.toLowerCase().endsWith('.md') ||
                  preview.relativePath.toLowerCase().endsWith('.markdown')
                    ? h(primitives.MarkdownText, {
                      text: read.text === undefined ? '' : read.text,
                      labels: { code: { copyLabel: '复制', copiedLabel: '已复制' }, footnotes: '脚注' },
                      omitHtml: true,
                    })
                    : h(primitives.CodeBlock, {
                      code: read.text === undefined ? '' : read.text,
                      lang: preview.relativePath.split('.').pop(),
                      lineNumbers: true,
                      copyLabel: '复制',
                      copiedLabel: '已复制',
                    }),
                  read.truncated ? h('p', { style: Object.assign({}, noteStyle, { borderTop: '0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2))', padding: '8px 12px' }) }, '文件较大，已截断显示。') : null
                )
          )
          : location === undefined
          ? h('p', { style: Object.assign({}, noteStyle, { padding: '12px' }) }, '尚无位置。先在「工作区」tab 关联或添加文件夹。')
          : h('div', { style: { flex: '1 1 auto', minHeight: 0, overflow: 'auto', padding: '2px 4px 14px' } },
            h(TreeSection, {
              key: workspace.id + '/' + location.id,
              workspaceId: workspace.id,
              location: location,
              renderFileTree: props.renderFileTree,
              sessionId: props.sessionId,
              openResource: props.openResource,
              onOpenPath: openFile,
            })
          )
      )
    }

    function LocusPageHeader(props) {
      var busyState = React.useState(false)
      var busy = busyState[0]
      var setBusy = busyState[1]
      var errorState = React.useState(undefined)
      var error = errorState[0]
      var setError = errorState[1]
      var controlMenuState = React.useState(undefined)
      var controlMenu = controlMenuState[0]
      var setControlMenu = controlMenuState[1]
      var locusWorkspaces = props.locusWorkspaces || []
      var dshWorkspaces = props.dshWorkspaces || []

      async function toggleAssociation() {
        try {
          await props.onToggleAssociation()
        } catch (cause) {
          setError(hostErrorText(cause))
        }
      }

      async function switchDsh(workspaceId) {
        if (workspaceId === '' || workspaceId === props.dshWorkspaceId) return
        setBusy(true)
        setError(undefined)
        try {
          await props.onSelectDshWorkspace(workspaceId)
        } catch (cause) {
          setError(errorText(cause))
        } finally {
          setBusy(false)
        }
      }

      function switchLocus(workspaceId) {
        if (workspaceId === '' || workspaceId === props.locusWorkspaceId) return
        props.onSelectLocusWorkspace(workspaceId)
      }

      var headerStyle = {
        background: 'var(--dsw-alias-bg-base, transparent)',
        borderBottom: '0.5px solid var(--dsw-alias-border-l3, rgba(128,128,128,0.2))',
        boxSizing: 'border-box',
        display: 'grid',
        flex: 'none',
        gridTemplateColumns: 'auto minmax(0, 1fr)',
        minHeight: '76px',
        padding: '10px 28px 0 20px',
        position: 'relative',
      }
      var titleRowStyle = {
        alignItems: 'center',
        display: 'flex',
        gridColumn: '2',
        minHeight: '30px',
        minWidth: 0,
        paddingInlineStart: 'max(0px, calc(var(--dsh-frame-leading-clearance, 0px) - 20px))',
      }
      var titleClusterStyle = {
        alignItems: 'center',
        display: 'flex',
        flex: '1 1 auto',
        gap: '10px',
        margin: '-4px -20px -4px -4px',
        minWidth: 0,
        overflow: 'clip',
        padding: '4px 20px 4px 4px',
      }
      var titleStyle = {
        borderRadius: 'var(--dsw-radius-md, 12px)',
        color: 'var(--dsw-alias-label-primary, inherit)',
        display: 'inline-block',
        fontSize: '14px',
        fontWeight: 500,
        lineHeight: '20px',
        maxWidth: '220px',
        overflow: 'hidden',
        padding: '4px 8px',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }
      var chipStyle = {
        alignItems: 'center',
        background: 'var(--dsw-alias-fill-tsp-secondary, rgba(128,128,128,0.1))',
        borderRadius: '4px',
        color: 'var(--dsw-alias-label-tertiary, inherit)',
        display: 'inline-flex',
        fontSize: '12px',
        fontWeight: 400,
        gap: '4px',
        height: '22px',
        lineHeight: '22px',
        maxWidth: '180px',
        overflow: 'hidden',
        padding: '0 6px',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }
      var utilitiesStyle = { alignItems: 'center', display: 'flex', flex: 'none', gap: '8px', marginLeft: '20px' }
      var controlButtonStyle = {
        alignItems: 'center',
        background: 'transparent',
        border: 'none',
        borderRadius: '8px',
        color: 'var(--dsw-alias-label-secondary, inherit)',
        cursor: 'pointer',
        display: 'flex',
        height: '28px',
        justifyContent: 'center',
        padding: 0,
        width: '28px',
      }
      var controlMenuStyle = {
        background: 'var(--dsw-alias-bg-layer-1, white)',
        border: '0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2))',
        borderRadius: '9px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.16)',
        display: 'grid',
        gap: '2px',
        minWidth: '170px',
        padding: '4px',
        position: 'absolute',
        right: 0,
        top: 'calc(100% + 4px)',
        zIndex: 230,
      }
      var controlMenuItemStyle = {
        background: 'transparent',
        border: 'none',
        borderRadius: '6px',
        color: 'var(--dsw-alias-label-primary, inherit)',
        cursor: 'pointer',
        font: 'inherit',
        fontSize: '12px',
        padding: '6px 8px',
        textAlign: 'left',
        whiteSpace: 'nowrap',
        width: '100%',
      }
      var tabsStyle = {
        alignItems: 'flex-start',
        display: 'flex',
        flexWrap: 'wrap',
        gap: '16px 20px',
        gridColumn: '1 / -1',
        marginTop: '10px',
        minWidth: 0,
        paddingLeft: '8px',
        position: 'relative',
        width: '100%',
        zIndex: 1,
      }
      var viewTabsStyle = { display: 'flex', flexWrap: 'wrap', gap: '32px', minHeight: '25px', minWidth: 0 }
      var tabStyle = {
        background: 'none',
        border: 'none',
        boxSizing: 'border-box',
        color: 'var(--dsw-alias-label-tertiary, inherit)',
        cursor: 'pointer',
        fontSize: '13px',
        fontWeight: 500,
        lineHeight: '16px',
        margin: '-10px -10px 0',
        minHeight: '35px',
        padding: '10px 10px 9px',
        position: 'relative',
      }

      function tab(label, active, disabled, action) {
        return h('button', {
          type: 'button',
          disabled: disabled,
          'aria-current': active ? 'page' : undefined,
          onClick: action,
          style: Object.assign({}, tabStyle,
            active ? { color: 'var(--dsw-alias-state-business-primary, inherit)' } : {},
            disabled ? { cursor: 'default', opacity: 0.45 } : {}),
        }, label, active ? h('span', {
          style: {
            background: 'var(--dsw-alias-state-business-primary, currentColor)',
            borderRadius: '2px',
            bottom: '-1px',
            height: '2px',
            left: '10px',
            position: 'absolute',
            right: '10px',
          },
        }) : null)
      }

      function menuButton(key, label, action, disabled) {
        return h('button', {
          key: key,
          type: 'button',
          disabled: disabled === true,
          style: Object.assign({}, controlMenuItemStyle, disabled === true ? { cursor: 'default', opacity: 0.45 } : {}),
          onClick: function () {
            if (disabled === true) return
            setControlMenu(undefined)
            action()
          },
        }, label)
      }

      function folderMenuItems() {
        return [
          menuButton('explorer', '打开文件树', props.onOpenExplorer, props.controlsDisabled),
          menuButton('dsh-folder', '切换到 DSH 文件夹', props.onOpenDshFolder, props.controlsDisabled),
          menuButton('workspaces', '管理工作区', props.onWorkspaces),
          menuButton('refresh', '刷新', props.onRefresh)
        ]
      }

      function moreMenuItems() {
        return [
          menuButton('workspaces', '管理工作区', props.onWorkspaces),
          props.associationVisible ? menuButton('association', props.associationActive ? '解除关联' : '关联到 DSH 工作区', function () { void toggleAssociation() }) : null,
          menuButton('dsh-folder', '打开 DSH 文件夹', props.onOpenDshFolder, props.controlsDisabled),
          menuButton('back', '切回 DSH 会话', props.onBackToDsh),
          menuButton('refresh', '刷新', props.onRefresh)
        ]
      }

      return h('div', { style: headerStyle, 'data-locus-page-header': true },
        h('div', { style: titleRowStyle },
          h('div', { style: titleClusterStyle },
            h('span', { style: titleStyle }, 'Locus'),
            h('button', {
              type: 'button',
              title: '返回 DSH 会话',
              'aria-label': '返回 DSH 会话',
              onClick: props.onBackToDsh,
              style: Object.assign({}, chipStyle, { border: 'none', cursor: 'pointer' }),
            }, 'DSH')
          ),
          h('div', { style: utilitiesStyle },
            h('button', {
              type: 'button',
              title: props.rightbarOpen ? '关闭文件树' : '打开文件树',
              'aria-label': props.rightbarOpen ? '关闭文件树' : '打开文件树',
              disabled: props.controlsDisabled,
              'aria-pressed': props.rightbarOpen,
              onClick: props.onToggleRightbar,
              style: Object.assign({}, controlButtonStyle, {
                background: props.rightbarOpen ? 'var(--dsw-alias-interactive-bg-active, rgba(128,128,128,0.16))' : 'transparent',
                borderRadius: '7px',
                opacity: props.controlsDisabled ? 0.45 : 1,
                width: '30px',
              }),
            }, h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', 'aria-hidden': 'true' },
              h('rect', { x: 3.5, y: 4.5, width: 17, height: 15, rx: 3, fill: 'none', stroke: 'currentColor', strokeWidth: 1.3 }),
              h('path', { d: 'M15 5v14', stroke: 'currentColor', strokeWidth: 1.3 })
            ))
          )
        ),
        h('div', { style: tabsStyle },
          h('div', { style: viewTabsStyle },
            tab('概览', props.routeKind === 'overview', props.onOverview === undefined, props.onOverview),
            tab('文件', props.routeKind === 'files', props.onFiles === undefined, props.onFiles),
            tab('工作区', props.routeKind === 'workspaces', false, props.onWorkspaces)
          )
        ),
        error === undefined ? null : h('div', {
          style: {
            background: 'var(--dsw-alias-bg-layer-1, white)',
            border: '0.5px solid var(--dsw-alias-state-error-primary, red)',
            borderRadius: '8px',
            color: 'var(--dsw-alias-state-error-primary, red)',
            fontSize: '11px',
            left: '20px',
            maxWidth: '420px',
            padding: '6px 8px',
            position: 'absolute',
            top: 'calc(100% + 6px)',
            zIndex: 220,
          },
        }, error)
      )
    }

    /** Workspace 管理面板：创建/改名、位置登记、DSH 工作区关联；嵌入模式下作为工作区 tab。 */
    function LocusWorkspaceManager(props) {
      var ctx = props.ctx
      var request = props.request === undefined ? null : props.request
      var embedded = props.embedded === true
      var data = useLocusData()
      var associations = useAssociations()
      var dsh = useDshState(ctx)
      var selectedState = React.useState(undefined)
      var selectedId = selectedState[0]
      var setSelectedId = selectedState[1]
      var pendingSelectState = React.useState(undefined)
      var pendingSelectId = pendingSelectState[0]
      var setPendingSelectId = pendingSelectState[1]
      var createNameState = React.useState('')
      var createName = createNameState[0]
      var setCreateName = createNameState[1]
      var renameNameState = React.useState('')
      var renameName = renameNameState[0]
      var setRenameName = renameNameState[1]
      var pathState = React.useState('')
      var path = pathState[0]
      var setPath = pathState[1]
      var busyState = React.useState(false)
      var busy = busyState[0]
      var setBusy = busyState[1]
      var errorState = React.useState(undefined)
      var error = errorState[0]
      var setError = errorState[1]
      var confirmState = React.useState(undefined)
      var confirmLocationId = confirmState[0]
      var setConfirmLocationId = confirmState[1]
      var appliedRequest = React.useRef(undefined)

      var workspaces = data.workspaces
      var openKey = request === null
        ? undefined
        : (request.dshWorkspaceId || '') + '|' + (request.sessionId || '')
      var selected = workspaces.find(function (item) { return item.id === selectedId })
      var dshWorkspaces = dsh.workspaces.items || []
      var dshWorkspace
      if (request !== null && request.dshWorkspaceId !== undefined) {
        dshWorkspace = dshWorkspaces.find(function (item) { return item.workspaceId === request.dshWorkspaceId })
      }
      var association = request === null ? undefined : associationOf(associations.items, request.dshWorkspaceId)
      var associatedWorkspace = association === undefined
        ? undefined
        : workspaces.find(function (item) { return item.id === association.locusWorkspaceId })
      var selectedAssociated = selected !== undefined && association !== undefined && association.locusWorkspaceId === selected.id
      var canAssociate = request !== null && request.dshWorkspaceId !== undefined && selected !== undefined

      React.useEffect(function () {
        if (openKey === undefined) {
          appliedRequest.current = undefined
          return
        }
        if (appliedRequest.current === openKey) return
        var preferred = request.initialWorkspaceId
        var hasPreferred = preferred !== undefined && workspaces.some(function (item) { return item.id === preferred })
        if (!hasPreferred && workspaces.length === 0) return
        appliedRequest.current = openKey
        setSelectedId(hasPreferred ? preferred : workspaces[0].id)
      }, [openKey, request, workspaces])

      React.useEffect(function () {
        if (pendingSelectId === undefined) return
        if (!workspaces.some(function (item) { return item.id === pendingSelectId })) return
        setSelectedId(pendingSelectId)
        setPendingSelectId(undefined)
      }, [pendingSelectId, workspaces])

      React.useEffect(function () {
        setRenameName(selected === undefined ? '' : selected.name)
      }, [selectedId, selected === undefined ? undefined : selected.name])

      React.useEffect(function () {
        if (request !== null) return
        setConfirmLocationId(undefined)
        setError(undefined)
      }, [request])

      if (request === null) return null

      function close() {}

      function perform(action, refresh) {
        if (busy) return
        setBusy(true)
        setError(undefined)
        action().then(function () {
          if (refresh !== false) window.dispatchEvent(new Event('locus:data-changed'))
        }).catch(function (cause) {
          setError(hostErrorText(cause))
        }).finally(function () {
          setBusy(false)
        })
      }

      function createWorkspace() {
        var name = createName.trim()
        if (name === '') {
          setError('请输入 Workspace 名称')
          return
        }
        perform(function () {
          return apiSend('/workspaces', 'POST', { name: name }).then(function (result) {
            setPendingSelectId(result.workspace.id)
            setCreateName('')
          })
        })
      }

      function renameWorkspace() {
        if (selected === undefined) return
        var name = renameName.trim()
        if (name === '') {
          setError('请输入 Workspace 名称')
          return
        }
        if (name === selected.name) return
        perform(function () {
          return apiSend('/workspaces/rename', 'POST', { workspaceId: selected.id, name: name })
        })
      }

      function toggleAssociation() {
        if (!canAssociate || busy) return
        perform(function () {
          return apiSend('/associations', 'POST', {
            dshWorkspaceId: request.dshWorkspaceId,
            locusWorkspaceId: selected.id,
            dshWorkspacePath: dshWorkspace === undefined ? undefined : dshWorkspace.path,
            associated: !selectedAssociated,
          }).then(function () {
            window.dispatchEvent(new Event('locus:associations-changed'))
          })
        })
      }

      function addLocation() {
        if (selected === undefined) return
        var value = path.trim()
        if (value === '') {
          setError('请输入绝对路径')
          return
        }
        perform(function () {
          return apiSend('/locations', 'POST', { workspaceId: selected.id, path: value }).then(function () {
            setPath('')
          })
        })
      }

      function removeLocation(location) {
        if (selected === undefined) return
        if (confirmLocationId !== location.id) {
          setConfirmLocationId(location.id)
          setError(undefined)
          return
        }
        perform(function () {
          return apiSend('/locations/remove', 'POST', {
            workspaceId: selected.id,
            locationId: location.id,
          }).then(function () {
            setConfirmLocationId(undefined)
          })
        })
      }

      function pickDirectory() {
        if (busy) return
        setBusy(true)
        setError(undefined)
        apiSend('/pick-directory', 'POST', {}).then(function (result) {
          if (result.kind !== 'native') throw new Error('当前 Host 只提供浏览式选择器；请直接填写绝对路径。')
          if (typeof result.path === 'string' && result.path !== '') setPath(result.path)
        }).catch(function (cause) {
          setError(hostErrorText(cause))
        }).finally(function () {
          setBusy(false)
        })
      }

      var overlayStyle = {
        alignItems: 'center',
        background: 'rgba(0, 0, 0, 0.32)',
        display: 'flex',
        inset: 0,
        justifyContent: 'center',
        padding: '24px',
        position: 'fixed',
        zIndex: 1000,
      }
      var dialogStyle = {
        background: 'var(--dsw-alias-bg-layer-1, white)',
        border: '0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2))',
        borderRadius: '14px',
        boxShadow: '0 24px 64px rgba(0, 0, 0, 0.28)',
        color: 'var(--dsw-alias-label-primary, inherit)',
        display: 'flex',
        flexDirection: 'column',
        maxHeight: 'min(720px, calc(100vh - 48px))',
        maxWidth: '100%',
        overflow: 'hidden',
        width: '780px',
      }
      var embeddedFrameStyle = {
        boxSizing: 'border-box',
        display: 'flex',
        flex: '1 1 auto',
        minHeight: 0,
        overflow: 'hidden',
        padding: '16px 24px 24px',
      }
      var embeddedDialogStyle = Object.assign({}, dialogStyle, {
        background: 'transparent',
        border: 'none',
        boxShadow: 'none',
        display: 'flex',
        flex: '1 1 auto',
        flexDirection: 'column',
        maxHeight: 'none',
        maxWidth: 'none',
        minHeight: 0,
        width: '100%',
      })
      var headStyle = {
        alignItems: 'flex-start',
        borderBottom: '0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2))',
        display: 'flex',
        gap: '12px',
        justifyContent: 'space-between',
        padding: '16px 18px 14px',
      }
      var bodyStyle = {
        display: 'flex',
        flex: '1 1 auto',
        minHeight: 0,
      }
      var sidebarStyle = {
        borderRight: '0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2))',
        display: 'flex',
        flex: 'none',
        flexDirection: 'column',
        minHeight: 0,
        padding: '10px',
        width: '238px',
      }
      var detailStyle = {
        display: 'flex',
        flex: '1 1 360px',
        flexDirection: 'column',
        gap: '16px',
        minHeight: 0,
        minWidth: 0,
        overflow: 'auto',
        padding: '16px 18px 20px',
      }
      var footStyle = {
        alignItems: 'center',
        borderTop: '0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2))',
        display: 'flex',
        gap: '10px',
        justifyContent: 'space-between',
        padding: '10px 18px',
      }
      var sectionTitleStyle = {
        alignItems: 'center',
        display: 'flex',
        fontSize: '12px',
        fontWeight: 600,
        gap: '8px',
        justifyContent: 'space-between',
        marginBottom: '8px',
      }
      var cardStyle = {
        background: 'var(--dsw-alias-fill-tsp-secondary, rgba(128,128,128,0.08))',
        border: '0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2))',
        borderRadius: '10px',
        padding: '12px',
      }
      var itemStyle = {
        background: 'transparent',
        border: 'none',
        borderRadius: '8px',
        color: 'var(--dsw-alias-label-primary, inherit)',
        cursor: 'pointer',
        display: 'block',
        font: 'inherit',
        padding: '8px',
        textAlign: 'left',
        width: '100%',
      }

      var managerDialog = h('div', {
        'aria-label': embedded ? 'Locus Workspaces' : undefined,
        'aria-labelledby': embedded ? undefined : 'locus-workspace-manager-title',
        'aria-modal': embedded ? undefined : 'true',
        role: embedded ? 'region' : 'dialog',
        style: embedded ? embeddedDialogStyle : dialogStyle,
      },
          embedded ? null : h('header', { style: headStyle },
            h('div', { style: { minWidth: 0 } },
              h('h2', {
                id: 'locus-workspace-manager-title',
                style: { fontSize: '15px', fontWeight: 600, lineHeight: '22px', margin: 0 },
              }, 'Locus Workspaces'),
              h('p', { style: Object.assign({}, noteStyle, { marginTop: '2px' }) },
                dshWorkspace === undefined
                  ? '管理长期 Workspace；当前 Session 未绑定 DSH 工作区。'
                  : '管理长期 Workspace，并关联到 DSH 工作区「' + (dshWorkspace.title || dshWorkspace.workspaceId) + '」。')
            ),
            embedded ? null : h('button', {
              type: 'button',
              title: '关闭',
              'aria-label': '关闭',
              onClick: close,
              style: Object.assign({}, buttonStyle, { border: 'none', fontSize: '18px', lineHeight: '20px', padding: '2px 6px' }),
            }, '×')
          ),
          h('div', { style: bodyStyle },
            h('aside', { style: sidebarStyle },
              h('div', { style: sectionTitleStyle },
                h('span', null, 'Workspace'),
                h('span', { style: Object.assign({}, noteStyle, { fontSize: '11px' }) }, String(workspaces.length))
              ),
              h('div', { style: { flex: '1 1 auto', minHeight: 0, overflow: 'auto' } },
                data.loading && workspaces.length === 0
                  ? h('p', { style: Object.assign({}, noteStyle, { padding: '8px' }) }, '正在读取…')
                  : data.error !== undefined && workspaces.length === 0
                    ? h('p', { style: Object.assign({}, noteStyle, { color: 'var(--dsw-alias-state-error-primary, inherit)', padding: '8px' }) }, data.error)
                    : workspaces.length === 0
                      ? h('p', { style: Object.assign({}, noteStyle, { padding: '8px' }) }, '还没有 Workspace。先创建一个。')
                      : workspaces.map(function (workspace) {
                        var active = selected !== undefined && selected.id === workspace.id
                        var linked = association !== undefined && association.locusWorkspaceId === workspace.id
                        return h('button', {
                          key: workspace.id,
                          type: 'button',
                          onClick: function () {
                            setSelectedId(workspace.id)
                            setConfirmLocationId(undefined)
                            setError(undefined)
                          },
                          style: Object.assign({}, itemStyle, active
                            ? { background: 'var(--dsw-alias-interactive-bg-active, rgba(128,128,128,0.16))' }
                            : {}),
                        },
                          h('span', { style: { display: 'flex', gap: '6px', justifyContent: 'space-between' } },
                            h('span', { style: { fontSize: '12px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, workspace.name),
                            linked ? h('span', {
                              style: {
                                color: 'var(--dsw-alias-state-business-primary, inherit)',
                                flex: 'none',
                                fontSize: '10px',
                              },
                            }, '已关联') : null
                          ),
                          h('span', {
                            style: Object.assign({}, noteStyle, { display: 'block', fontSize: '10px', marginTop: '2px' }),
                          }, workspace.locations.length + ' 个位置 · ' + workspace.relationCount + ' 条关系')
                        )
                      })
              ),
              h('form', {
                style: { borderTop: '0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2))', display: 'grid', gap: '6px', paddingTop: '10px' },
                onSubmit: function (event) { event.preventDefault(); createWorkspace() },
              },
                h('input', {
                  'aria-label': '新 Workspace 名称',
                  autoComplete: 'off',
                  disabled: busy,
                  onChange: function (event) { setCreateName(event.currentTarget.value) },
                  placeholder: '新 Workspace 名称',
                  style: inputStyle,
                  value: createName,
                }),
                h('button', {
                  type: 'submit',
                  disabled: busy || createName.trim() === '',
                  style: Object.assign({}, buttonStyle, {
                    opacity: busy || createName.trim() === '' ? 0.55 : 1,
                    width: '100%',
                  }),
                }, '创建')
              )
            ),
            h('div', { style: detailStyle },
              error === undefined ? null : h('div', {
                style: {
                  background: 'var(--dsw-alias-fill-tsp-secondary, rgba(128,128,128,0.08))',
                  border: '0.5px solid var(--dsw-alias-state-error-primary, rgba(220,50,50,0.5))',
                  borderRadius: '8px',
                  color: 'var(--dsw-alias-state-error-primary, inherit)',
                  fontSize: '12px',
                  padding: '7px 9px',
                },
              }, error),
              selected === undefined
                ? h('p', { style: noteStyle }, '选择或创建一个 Workspace 以管理位置与关联。')
                : h(React.Fragment, null,
                  h('section', null,
                    h('form', {
                      style: { alignItems: 'flex-start', display: 'flex', gap: '8px' },
                      onSubmit: function (event) { event.preventDefault(); renameWorkspace() },
                    },
                      h('input', {
                        'aria-label': 'Workspace 名称',
                        disabled: busy,
                        onChange: function (event) { setRenameName(event.currentTarget.value) },
                        style: Object.assign({}, inputStyle, { fontSize: '14px', fontWeight: 600 }),
                        value: renameName,
                      }),
                      h('button', {
                        type: 'submit',
                        disabled: busy || renameName.trim() === '' || renameName.trim() === selected.name,
                        style: Object.assign({}, buttonStyle, {
                          flex: 'none',
                          opacity: busy || renameName.trim() === '' || renameName.trim() === selected.name ? 0.55 : 1,
                        }),
                      }, '改名')
                    ),
                    h('p', { style: Object.assign({}, noteStyle, { fontFamily: mono, fontSize: '10px', marginTop: '5px' }) }, selected.id)
                  ),
                  h('section', null,
                    h('div', { style: sectionTitleStyle }, h('span', null, 'DSH 工作区关联')),
                    h('div', { style: cardStyle },
                      h('p', { style: Object.assign({}, noteStyle, { marginBottom: '8px' }) },
                        association === undefined
                          ? '当前 DSH 工作区尚未关联 Locus Workspace。'
                          : '当前关联：' + (associatedWorkspace === undefined ? association.locusWorkspaceId : associatedWorkspace.name) + '。'),
                      dshWorkspace === undefined || dshWorkspace.path === undefined ? null : h('p', {
                        style: Object.assign({}, noteStyle, { fontFamily: mono, fontSize: '10px', marginBottom: '8px', overflowWrap: 'anywhere' }),
                        title: '关联后自动登记为位置',
                      }, dshWorkspace.path),
                      h('button', {
                        type: 'button',
                        disabled: !canAssociate || busy,
                        onClick: toggleAssociation,
                        style: Object.assign({}, buttonStyle, {
                          background: selectedAssociated
                            ? 'transparent'
                            : 'var(--dsw-alias-state-business-primary, #4d6bfe)',
                          border: selectedAssociated
                            ? '0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2))'
                            : 'none',
                          color: selectedAssociated ? 'inherit' : '#fff',
                          opacity: !canAssociate || busy ? 0.55 : 1,
                        }),
                      }, selectedAssociated ? '解除关联' : '关联到此 Workspace'),
                      selectedAssociated ? null : h('p', {
                        style: Object.assign({}, noteStyle, { fontSize: '11px', marginTop: '7px' }),
                      }, '一个 DSH 工作区最多关联一个 Locus Workspace；关联新的会替换旧关联。')
                    )
                  ),
                  h('section', null,
                    h('div', { style: sectionTitleStyle },
                      h('span', null, '位置'),
                      h('span', { style: Object.assign({}, noteStyle, { fontSize: '11px' }) }, String(selected.locations.length))
                    ),
                    selected.locations.length === 0
                      ? h('p', { style: Object.assign({}, noteStyle, { marginBottom: '8px' }) }, '尚未登记位置。登记只建立发现入口，不创建成员关系。')
                      : h('div', { style: { display: 'grid', gap: '6px', marginBottom: '8px' } },
                        selected.locations.map(function (location) {
                          var confirming = confirmLocationId === location.id
                          return h('div', {
                            key: location.id,
                            style: {
                              alignItems: 'center',
                              border: '0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2))',
                              borderRadius: '8px',
                              display: 'flex',
                              gap: '8px',
                              padding: '7px 9px',
                            },
                          },
                            h('span', {
                              style: {
                                flex: '1 1 auto',
                                fontFamily: mono,
                                fontSize: '11px',
                                minWidth: 0,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              },
                              title: location.path,
                            }, location.path),
                            dshWorkspace !== undefined && dshWorkspace.path === location.path ? h('span', {
                              style: { color: 'var(--dsw-alias-state-business-primary, inherit)', flex: 'none', fontSize: '10px' },
                            }, 'DSH') : null,
                            h('button', {
                              type: 'button',
                              disabled: busy,
                              onClick: function () { removeLocation(location) },
                              style: Object.assign({}, buttonStyle, {
                                color: confirming ? 'var(--dsw-alias-state-error-primary, inherit)' : undefined,
                                flex: 'none',
                                fontSize: '11px',
                                padding: '3px 7px',
                              }),
                            }, confirming ? '确认移除' : '移除')
                          )
                        })
                      ),
                    h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } },
                      h('input', {
                        'aria-label': '位置绝对路径',
                        disabled: busy,
                        onChange: function (event) { setPath(event.currentTarget.value) },
                        onKeyDown: function (event) {
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            addLocation()
                          }
                        },
                        placeholder: '绝对路径，例如 X:\\Projects',
                        style: Object.assign({}, inputStyle, { flex: '1 1 240px', width: 'auto' }),
                        value: path,
                      }),
                      h('button', {
                        type: 'button',
                        disabled: busy,
                        onClick: pickDirectory,
                        style: Object.assign({}, buttonStyle, { flex: 'none' }),
                      }, '选择目录'),
                      h('button', {
                        type: 'button',
                        disabled: busy || path.trim() === '',
                        onClick: addLocation,
                        style: Object.assign({}, buttonStyle, {
                          flex: 'none',
                          opacity: busy || path.trim() === '' ? 0.55 : 1,
                        }),
                      }, '添加')
                    )
                  )
                )
            )
          ),
          embedded ? null : h('footer', { style: footStyle },
            h('span', { style: Object.assign({}, noteStyle, { fontSize: '11px' }) }, '改动写入 Locus Core；不写文件内容。'),
            h('button', {
              type: 'button',
              disabled: busy,
              onClick: close,
              style: Object.assign({}, buttonStyle, { padding: '6px 14px' }),
            }, '完成')
          )
        )
      if (embedded) return h('div', { style: embeddedFrameStyle }, managerDialog)
      return h('div', {
        style: overlayStyle,
        onMouseDown: function (event) {
          if (event.target === event.currentTarget) close()
        },
      }, managerDialog)
    }

    /** Session-scoped body rendered inside the provider; the Factory receives a real Session scope. */
    function EmbeddedSessionView(props) {
      var session = props.useSession === undefined ? undefined : props.useSession(function (value) { return value })
      if (session === undefined) {
        return h('p', { style: Object.assign({}, noteStyle, { padding: '16px' }) }, '正在打开 Session…')
      }
      var conversation = props.useConversation === undefined ? undefined : props.useConversation(function (value) { return value })
      var shellPhase = conversation === undefined
        ? 'blank'
        : (conversation.activeTargets.size > 0 || (!session.blank && !session.awaitingFirstTurn) || session.running
          ? 'active'
          : session.promptAttempted ? 'engaging' : 'blank')
      var summaryBlank = props.useSessions === undefined
        ? undefined
        : props.useSessions(function (state) {
          var row = props.sessionId === undefined ? undefined : state.byId[props.sessionId]
          return row === undefined ? undefined : row.blank
        })
      var settling = shellPhase === 'blank' && session.openState === 'loading' && summaryBlank !== true
      var hero = shellPhase === 'blank' && (session.openState === 'open' || summaryBlank === true)
      if (props.renderFactorySlot === undefined) {
        return h('p', { style: Object.assign({}, noteStyle, { padding: '16px' }) }, 'Conversation 嵌入不可用')
      }
      function ViewContent(localProps) {
        return localProps.renderSlot('conversation.session', props.view === undefined ? {} : { view: props.view })
      }
      return props.renderFactorySlot('conversation.content', {
        variant: 'embedded',
        phase: settling ? 'settling' : hero ? 'hero' : 'active',
        hero: hero,
      }, { slots: { views: ViewContent } })
    }

    function apply(ctx) {
      function EmbeddedSession(props) {
        var dsh = useDshState(ctx)
        var summary = dsh.sessions.byId[props.sessionId]
        var listReady = dsh.sessions.phase === 'ready' || summary !== undefined
        var referenceState = React.useState(undefined)
        var reference = referenceState[0]
        var setReference = referenceState[1]
        var errorState = React.useState(undefined)
        var error = errorState[0]
        var setError = errorState[1]
        React.useEffect(function () {
          if (!listReady) return
          if (summary === undefined) {
            setError('Session 不存在或未加载')
            return
          }
          var held
          setReference(undefined)
          setError(undefined)
          try {
            held = ctx.sessions.retain(props.sessionId, { source: 'locusPanel' })
            setReference(held)
          } catch (cause) {
            setError(errorText(cause))
          }
          return function () {
            if (held !== undefined) held.release()
          }
        }, [props.sessionId, listReady, summary === undefined])
        if (error !== undefined) {
          return h('p', { style: Object.assign({}, noteStyle, { padding: '16px', color: 'var(--dsw-alias-state-error-primary, inherit)' }) }, error)
        }
        if (reference === undefined) {
          return h('p', { style: Object.assign({}, noteStyle, { padding: '16px' }) }, '正在打开 Session…')
        }
        if (props.SessionProvider === undefined || props.renderSlot === undefined) {
          return h('p', { style: Object.assign({}, noteStyle, { padding: '16px' }) }, 'SessionProvider 不可用')
        }
        return h(props.SessionProvider, { session: reference }, props.renderSlot('locus.embedded.session', {
          sessionId: props.sessionId,
          view: props.view,
        }))
      }

      function LocusPage(props) {
        var data = useLocusData()
        var host = useHostCapabilities()
        var routing = useLocusRoute()
        var dsh = useDshState(ctx)
        var associations = useAssociations()
        var dshViews = useDshViews(ctx)
        var route = routing.route === null ? { kind: 'workspaces' } : routing.route
        var hostIncompatible = !host.loading && (host.value === undefined || host.value.workspaceManagement !== true)
        var navigate = routing.navigate
        var replace = routing.replace
        var dshWorkspaces = dsh.workspaces.items || []
        var dshContext = readDshContext()
        var currentSessionId = readDshCurrentSession()
        var defaultSessionId = currentSessionId !== undefined && dsh.sessions.byId[currentSessionId] !== undefined
          ? currentSessionId
          : (embeddedSessionId === undefined
            ? (dshContext === undefined || dshContext.sessionId === undefined ? readLastSession() : dshContext.sessionId)
            : embeddedSessionId)
        if (defaultSessionId === undefined || dsh.sessions.byId[defaultSessionId] === undefined) {
          defaultSessionId = dsh.sessions.ids[0]
        }
        var sessionId = route.kind === 'session' ? (route.sessionId || defaultSessionId) : defaultSessionId
        var dshWorkspaceId
        if (sessionId !== undefined) {
          for (var index = 0; index < dshWorkspaces.length; index += 1) {
            if ((dshWorkspaces[index].sessionIds || []).indexOf(sessionId) !== -1) {
              dshWorkspaceId = dshWorkspaces[index].workspaceId
              break
            }
          }
        }
        var dshWorkspace = dshWorkspaces.find(function (item) { return item.workspaceId === dshWorkspaceId })
        var dshWorkspacePath = dshWorkspace === undefined ? undefined : dshWorkspace.path
        var sessionOptions = []
        if (dshWorkspace !== undefined) {
          ;(dshWorkspace.sessionIds || []).forEach(function (id) {
            var summary = dsh.sessions.byId[id]
            if (summary !== undefined && summary.blank) return
            sessionOptions.push({ value: id, label: summary === undefined ? id : (summary.displayTitle || id) })
          })
        }
        if (sessionOptions.length === 0 && sessionId !== undefined) {
          var currentSummary = dsh.sessions.byId[sessionId]
          sessionOptions.push({ value: sessionId, label: currentSummary === undefined ? sessionId : (currentSummary.displayTitle || sessionId) })
        }
        var association = associationOf(associations.items, dshWorkspaceId)
        var workspaceId = route.workspaceId !== undefined
          ? route.workspaceId
          : association !== undefined
            ? association.locusWorkspaceId
            : (data.workspaces[0] === undefined ? undefined : data.workspaces[0].id)
        var workspace = data.workspaces.find(function (item) { return item.id === workspaceId })
        if (workspace === undefined && route.workspaceId === undefined) {
          workspace = data.workspaces[0]
        }
        var workspaceMissing = route.workspaceId !== undefined && workspace === undefined && !data.loading && data.error === undefined
        var routeKind = route.kind === 'session' ? 'workspaces' : route.kind
        var sessionTitle = sessionId === undefined || dsh.sessions.byId[sessionId] === undefined
          ? undefined
          : dsh.sessions.byId[sessionId].displayTitle
        var selectedDshView = route.kind === 'session'
          ? (route.view !== undefined && dshViews.some(function (item) { return item.id === route.view })
            ? route.view
            : (dshViews[0] === undefined ? undefined : dshViews[0].id))
          : undefined
        var tabsState = React.useState(true)
        var dshTabsOpen = tabsState[0]
        var setDshTabsOpen = tabsState[1]
        var rightbarState = React.useState(false)
        var rightbarOpen = rightbarState[0]
        var setRightbarOpen = rightbarState[1]
        var rightbarLocation = workspace === undefined
          ? undefined
          : (workspace.locations.find(function (location) { return location.path === dshWorkspacePath }) || workspace.locations[0])
        var controlsDisabled = workspace === undefined
        var associationActive = association !== undefined && workspace !== undefined && association.locusWorkspaceId === workspace.id
        var canAssociate = sessionId !== undefined && dshWorkspaceId !== undefined && workspace !== undefined

        React.useEffect(function () {
          if (dsh.sessions.phase === 'ready') return
          ctx.sessions.refresh().catch(function () {})
        }, [dsh.sessions.phase])

        React.useEffect(function () {
          if (sessionId !== undefined) {
            writeLastSession(sessionId)
            embeddedSessionId = sessionId
          }
        }, [sessionId])

        React.useEffect(function () {
          if (sessionId === undefined && dshWorkspaceId === undefined) return
          writeDshContext({
            sessionId: sessionId,
            workspaceId: dshWorkspaceId,
            workspacePath: dshWorkspacePath,
          })
        }, [sessionId, dshWorkspaceId, dshWorkspacePath])

        React.useEffect(function () {
          if (route.kind !== 'session' || route.view === undefined || dshViews.length === 0) return
          if (dshViews.some(function (item) { return item.id === route.view })) return
          replace({ kind: 'session', sessionId: route.sessionId, view: dshViews[0].id })
        }, [route.kind, route.sessionId, route.view, dshViews, replace])

        React.useEffect(function () {
          if (routeKind !== 'files' || route.workspaceId === undefined || route.locationId === undefined) return
          if (workspace === undefined) return
          if (workspace.locations.some(function (location) { return location.id === route.locationId })) return
          replace({ kind: 'files', workspaceId: workspace.id })
        }, [routeKind, route.workspaceId, route.locationId, workspace, replace])

        function openSession() {
          navigate({
            kind: 'session',
            sessionId: route.kind === 'session' ? route.sessionId : sessionId,
            view: selectedDshView,
          })
        }

        function selectDshView(viewId) {
          if (sessionId === undefined) return
          navigate({ kind: 'session', sessionId: sessionId, view: viewId })
        }

        function selectSession(nextSessionId) {
          navigate({ kind: 'session', sessionId: nextSessionId, view: selectedDshView })
        }

        async function setAssociation(associated) {
          if (!canAssociate) return
          await apiSend('/associations', 'POST', {
            dshWorkspaceId: dshWorkspaceId,
            locusWorkspaceId: workspace.id,
            dshWorkspacePath: dshWorkspacePath,
            associated: associated,
          })
          window.dispatchEvent(new Event('locus:associations-changed'))
          window.dispatchEvent(new Event('locus:data-changed'))
        }

        async function toggleAssociation() {
          await setAssociation(!associationActive)
        }

        function openOverview() {
          if (workspace === undefined) return
          navigate({ kind: 'overview', workspaceId: workspace.id })
        }

        function openFiles(locationId) {
          if (workspace === undefined) return
          navigate({ kind: 'files', workspaceId: workspace.id, locationId: locationId || route.locationId })
        }

        function selectLocusWorkspace(nextWorkspaceId) {
          navigate(routeKind === 'files'
            ? { kind: 'files', workspaceId: nextWorkspaceId, locationId: route.locationId }
            : { kind: 'overview', workspaceId: nextWorkspaceId })
        }

        async function selectDshWorkspace(nextWorkspaceId) {
          var nextSessionId = await ctx.uiWorkspace.connectWorkspace(nextWorkspaceId)
          ctx.uiWorkspace.openSession(nextSessionId)
          navigate({ kind: 'session', sessionId: nextSessionId })
        }

        function backToDsh() {
          var targetSessionId = sessionId !== undefined
            ? sessionId
            : (dshContext === undefined ? undefined : dshContext.sessionId)
          if (targetSessionId !== undefined) {
            try {
              ctx.uiWorkspace.openSession(targetSessionId)
              return
            } catch {
              /* fall back to Conversation */
            }
          }
          ctx.layout.selectPanel(null)
        }

        function openWorkspaces() {
          navigate({ kind: 'workspaces' })
        }

        function toggleRightbar() {
          if (controlsDisabled) return
          try {
            ctx.sidebarRight.toggleExpanded()
            return
          } catch {
            /* rightbar unavailable; fall back to the local tree */
          }
          setRightbarOpen(function (value) { return !value })
        }

        function openExplorer() {
          if (controlsDisabled) return
          try {
            if (typeof ctx.sidebarRight.isExpanded !== 'function' || !ctx.sidebarRight.isExpanded()) {
              ctx.sidebarRight.toggleExpanded()
            }
            return
          } catch {
            /* rightbar unavailable; fall back to the local tree */
          }
          setRightbarOpen(true)
        }

        function openDshFolder() {
          if (workspace === undefined) return
          var location = workspace.locations.find(function (item) { return item.path === dshWorkspacePath })
          if (location === undefined) {
            openWorkspaces()
            return
          }
          navigate({ kind: 'files', workspaceId: workspace.id, locationId: location.id })
        }

        function openResource(address) {
          try {
            if (sessionId !== undefined && typeof ctx.sidebarRight.openResourceIn === 'function') {
              ctx.sidebarRight.openResourceIn(sessionId, address)
              return
            }
            ctx.sidebarRight.openResource(address)
          } catch {
            /* the right sidebar has no mounted Session */
          }
        }

        var header = h(LocusPageHeader, {
          routeKind: routeKind,
          locusWorkspaces: data.workspaces,
          locusWorkspaceId: workspace === undefined ? undefined : workspace.id,
          dshWorkspaces: dshWorkspaces,
          dshWorkspaceId: dshWorkspaceId,
          sessionTitle: sessionTitle,
          sessionId: sessionId,
          sessionOptions: sessionOptions,
          onSelectSession: selectSession,
          dshViews: dshViews,
          dshView: selectedDshView,
          dshTabsOpen: dshTabsOpen,
          onToggleDshTabs: function () { setDshTabsOpen(function (value) { return !value }) },
          onSelectDshView: selectDshView,
          onSession: openSession,
          onOverview: workspace === undefined ? undefined : openOverview,
          onFiles: workspace === undefined ? undefined : function () { openFiles() },
          onSelectLocusWorkspace: selectLocusWorkspace,
          onSelectDshWorkspace: selectDshWorkspace,
          onRefresh: data.reload,
          associationVisible: canAssociate,
          associationActive: associationActive,
          onToggleAssociation: toggleAssociation,
          onWorkspaces: openWorkspaces,
          onBackToDsh: backToDsh,
          onOpenExplorer: openExplorer,
          onOpenDshFolder: openDshFolder,
          onToggleRightbar: toggleRightbar,
          rightbarOpen: rightbarOpen,
          controlsDisabled: controlsDisabled,
        })

        var body
        if (route.kind === 'unknown') {
          body = h('div', { style: { display: 'grid', gap: '12px', justifyItems: 'start', padding: '32px 24px' } },
            h('div', { style: { fontSize: '16px', fontWeight: 600 } }, '页面不存在'),
            h('p', { style: noteStyle }, '该 Locus 地址无效或已被移除。'),
            h('button', { type: 'button', style: buttonStyle, onClick: openSession }, '返回会话'))
        } else if (data.loading) {
          body = h('div', { style: { padding: '32px 24px' } }, h('p', { style: noteStyle }, '正在读取 Locus Workspace…'))
        } else if (data.error !== undefined) {
          body = h('div', { style: { padding: '32px 24px' } },
            h('p', { style: Object.assign({}, noteStyle, { color: 'var(--dsw-alias-state-error-primary, inherit)' }) }, data.error),
            h('button', { type: 'button', style: Object.assign({}, buttonStyle, { marginTop: '12px' }), onClick: data.reload }, '重试'))
        } else if (workspaceMissing) {
          body = h('div', { style: { display: 'grid', gap: '12px', justifyItems: 'start', padding: '32px 24px' } },
            h('div', { style: { fontSize: '16px', fontWeight: 600 } }, 'Workspace 不存在'),
            h('p', { style: noteStyle }, 'URL 指向的 Workspace 未找到：' + (route.workspaceId || '')),
            h('button', { type: 'button', style: buttonStyle, onClick: function () { navigate({ kind: 'workspaces' }) } }, '返回管理工作区'))
        } else if (workspace === undefined) {
          body = h('div', { style: { display: 'grid', gap: '12px', justifyItems: 'start', padding: '32px 24px' } },
            h('p', { style: noteStyle }, '还没有 Workspace。创建后即可管理位置与关联。'),
            h('button', { type: 'button', style: buttonStyle, onClick: openWorkspaces }, '打开工作区'))
        } else if (routeKind === 'workspaces') {
          body = h(LocusWorkspaceManager, {
            ctx: ctx,
            embedded: true,
            request: {
              dshWorkspaceId: dshWorkspaceId,
              initialWorkspaceId: workspace === undefined ? undefined : workspace.id,
              sessionId: sessionId,
            },
          })
        } else if (routeKind === 'files') {
          body = h(FilesView, {
            key: workspace.id + ':' + data.revision,
            workspace: workspace,
            selectedLocationId: route.locationId,
            dshWorkspacePath: dshWorkspacePath,
            sessionId: sessionId,
            openResource: openResource,
            onSelectLocation: function (locationId) {
              navigate({ kind: 'files', workspaceId: workspace.id, locationId: locationId })
            },
            renderFileTree: function (input) { return props.renderFactorySlot('sidebar.files.tree', input) },
          })
        } else {
          body = h(Overview, {
            key: workspace.id + ':' + data.revision,
            workspace: workspace,
            onOpenFiles: function (locationId) {
              navigate({ kind: 'files', workspaceId: workspace.id, locationId: locationId })
            },
                      })
        }

        return h('div', {
          style: {
            background: 'var(--dsw-alias-bg-base, transparent)',
            color: 'var(--dsw-alias-label-primary, inherit)',
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            minHeight: 0,
          },
          'data-locus-main-panel': true,
        }, header,
        hostIncompatible ? h('div', {
          role: 'alert',
          style: {
            background: 'var(--dsw-alias-fill-tsp-secondary, rgba(128,128,128,0.08))',
            borderBottom: '0.5px solid var(--dsw-alias-state-error-primary, rgba(220,50,50,0.5))',
            color: 'var(--dsw-alias-state-error-primary, inherit)',
            flex: 'none',
            fontSize: '12px',
            padding: '7px 20px',
          },
        }, '当前 DSH Host 未加载最新 Locus API；请重启 DSH 进程后重试。仅刷新页面不会加载新的 Host 端点。') : null,
        h('div', {
          style: { display: 'flex', flex: '1 1 auto', minHeight: 0, minWidth: 0 },
        },
          h('div', { style: { display: 'flex', flex: '1 1 auto', minHeight: 0, minWidth: 0 } }, body),
          rightbarOpen ? h(LocusFilePane, {
            workspace: workspace,
            location: rightbarLocation,
            sessionId: sessionId,
            renderFileTree: function (input) { return props.renderFactorySlot('sidebar.files.tree', input) },
            openResource: openResource,
            onClose: function () { setRightbarOpen(false) },
          }) : null
        ))
      }

      function LocusHeaderAction(props) {
        var sessionId = props.sessionId
        return h('button', {
          type: 'button',
          title: '在 Locus 中打开',
          'aria-label': '在 Locus 中打开',
          onClick: function () {
            if (sessionId === undefined) return
            embeddedSessionId = sessionId
            writeLastSession(sessionId)
            window.location.hash = locusHash({ kind: 'session', sessionId: sessionId })
            ctx.layout.selectPanel(PANEL_ID)
          },
          style: {
            alignItems: 'center',
            background: 'var(--dsw-alias-fill-tsp-secondary, rgba(128,128,128,0.1))',
            border: 'none',
            borderRadius: 'var(--dsw-radius-xs, 6px)',
            color: 'var(--dsw-alias-label-tertiary, inherit)',
            cursor: 'pointer',
            display: 'inline-flex',
            font: 'inherit',
            fontSize: '12px',
            gap: '4px',
            height: '22px',
            lineHeight: '22px',
            padding: '0 6px',
            whiteSpace: 'nowrap',
          },
        }, h(LocusIcon, { size: 14 }), 'Locus')
      }

      function LocusNativeView(props) {
        var dsh = useDshState(ctx)
        var associations = useAssociations()
        var sessionId = props.sessionId
        var workspaces = dsh.workspaces.items || []
        var dshWorkspace
        if (sessionId !== undefined) {
          for (var index = 0; index < workspaces.length; index += 1) {
            if ((workspaces[index].sessionIds || []).indexOf(sessionId) !== -1) {
              dshWorkspace = workspaces[index]
              break
            }
          }
        }
        var association = associationOf(associations.items, dshWorkspace === undefined ? undefined : dshWorkspace.workspaceId)
        return h('div', {
          style: { display: 'flex', flex: '1 1 auto', minHeight: 0, minWidth: 0, width: '100%' },
        }, h(LocusWorkspaceManager, {
          ctx: ctx,
          embedded: true,
          request: {
            dshWorkspaceId: dshWorkspace === undefined ? undefined : dshWorkspace.workspaceId,
            initialWorkspaceId: association === undefined ? undefined : association.locusWorkspaceId,
            sessionId: sessionId,
          },
        }))
      }

      var panelReady = false
      function activePanel() {
        return ctx.layout.panelInfo.getSnapshot().activePanelId
      }
      function syncPanelFromHash() {
        if (!panelReady) return
        if (hashTargetsLocus(window.location.hash)) {
          if (activePanel() !== PANEL_ID) ctx.layout.selectPanel(PANEL_ID)
        } else if (activePanel() === PANEL_ID) {
          ctx.layout.selectPanel(null)
        }
      }
      function syncInitialHash() {
        if (!panelReady) return
        if (hashTargetsLocus(window.location.hash)) {
          if (activePanel() !== PANEL_ID) ctx.layout.selectPanel(PANEL_ID)
        } else if (activePanel() === PANEL_ID) {
          window.history.replaceState(null, '', '#/locus')
        }
      }

      ctx.effect(function () {
        window.addEventListener('hashchange', syncPanelFromHash)
        return function () { window.removeEventListener('hashchange', syncPanelFromHash) }
      }, 'locus-dsh-surface: hash navigation')

      ctx.effect(function () {
        return ctx.layout.panelInfo.subscribe(function () {
          if (!panelReady) return
          var active = activePanel()
          if (active === PANEL_ID && !hashTargetsLocus(window.location.hash)) {
            window.history.replaceState(null, '', '#/locus')
          } else if (active !== PANEL_ID && hashTargetsLocus(window.location.hash)) {
            window.history.replaceState(null, '', '#/')
          }
        })
      }, 'locus-dsh-surface: panel navigation')

      ctx.effect(function () {
        return ctx.slots.inject('main', function () {
          var dispose = ctx.slots.register({
            name: 'main',
            key: PANEL_ID,
          }, LocusPage)
          panelReady = true
          syncInitialHash()
          return dispose
        })
      }, 'locus-dsh-surface: main panel')

      ctx.effect(function () {
        return ctx.slots.inject('sidebar.panellist', function () {
          return ctx.slots.register({
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 10,
            label: function () { return 'Locus' },
          }, LocusIcon)
        })
      }, 'locus-dsh-surface: sidebar entry')

      ctx.effect(function () {
        return ctx.slots.inject('conversation.session.header.actions', function () {
          return ctx.slots.register({
            name: 'conversation.session.header.actions',
            id: 'locus-entry',
            order: 0,
          }, LocusHeaderAction)
        })
      }, 'locus-dsh-surface: session header entry')

    }

    exports.apply = apply
    exports.inject = ['slots', 'sessions', 'workspaces', 'layout', 'uiWorkspace', 'sidebarRight']
    return module.exports
  },
})
