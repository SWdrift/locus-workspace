(() => {
  const query = window.matchMedia('(prefers-color-scheme: dark)')
  const apply = () => {
    const dark = query.matches
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
    document.documentElement.setAttribute('data-ds-theme-source', 'system')
    if (dark) document.body.setAttribute('data-ds-dark-theme', '')
    else document.body.removeAttribute('data-ds-dark-theme')
  }
  apply()
  query.addEventListener('change', apply)
})()
