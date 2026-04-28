function normalizeString(value) {
  if (value == null) {
    return null
  }

  const normalized = String(value).trim()
  return normalized || null
}

function getStaticBuildInfo() {
  const candidate = globalThis.__HMS_STATIC_BUILD_INFO__
  return candidate && typeof candidate === 'object' ? candidate : {}
}

function getWindowBuildInfo() {
  const candidate = globalThis?.window?.__HMS_BUILD_INFO__
  return candidate && typeof candidate === 'object' ? candidate : {}
}

export function getBuildInfo() {
  const source = {
    ...getStaticBuildInfo(),
    ...getWindowBuildInfo(),
  }

  return {
    version: normalizeString(source.version) || '0.0.0',
    commit: normalizeString(source.commit),
    branch: normalizeString(source.branch),
    builtAt: normalizeString(source.builtAt),
    mode: normalizeString(source.mode) || normalizeString(import.meta.env?.MODE),
  }
}

export function publishBuildInfo() {
  const buildInfo = getBuildInfo()

  if (globalThis?.window) {
    globalThis.window.__HMS_BUILD_INFO__ = buildInfo
  }

  return buildInfo
}

export function formatBuildLabel(buildInfo = getBuildInfo()) {
  return buildInfo.commit ? `${buildInfo.version} (${buildInfo.commit})` : buildInfo.version
}
