import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { i18n } from './i18n/core.ts'

/** 显式路径完整决定位置；环境目录仅在 development Profile 下追加隔离子目录。 */
export function resolveDataDirectory(explicit?: string, profile = 'production'): string {
  if (explicit !== undefined) {
    if (typeof explicit !== 'string' || explicit.trim().length === 0 || !isAbsolute(explicit)) {
      throw new Error(i18n.t('core.data-directory-invalid'))
    }
    return resolve(explicit)
  }

  const folder = process.env.LOCUS_FOLDER_NAME
  if (
    folder !== undefined &&
    (folder.trim().length === 0 ||
      folder !== folder.trim() ||
      folder === '.' ||
      folder === '..' ||
      /[\\/:\u0000]/.test(folder))
  ) {
    throw new Error(i18n.t('core.folder-name-invalid'))
  }
  const home = process.env.LOCUS_HOME
  if (home !== undefined && home.trim().length === 0) {
    throw new Error(i18n.t('core.home-invalid'))
  }

  const base = home === undefined ? homedir() : resolve(home)
  const production =
    folder === undefined ? (home === undefined ? join(base, '.locus-workspace') : base) : join(base, folder)
  return profile === 'development' ? join(production, 'profiles', 'development') : production
}
