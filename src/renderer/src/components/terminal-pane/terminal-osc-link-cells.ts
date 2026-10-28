import type { ILinkProvider, Terminal } from '@xterm/xterm'
import { isCorruptedOscLinkText } from './terminal-osc-link-routing'

type LinkProviderListOwner = {
  _core?: {
    _linkProviderService?: { linkProviders?: ILinkProvider[] }
    linkifier?: { _linkProviderService?: { linkProviders?: ILinkProvider[] } }
  }
}

export function installCorruptedOscLinkFilter(terminal: Terminal): void {
  try {
    const core = (terminal as unknown as LinkProviderListOwner)._core
    const providers =
      core?._linkProviderService?.linkProviders ??
      core?.linkifier?._linkProviderService?.linkProviders
    if (Array.isArray(providers)) {
      for (const provider of providers) {
        if (!provider || typeof provider.provideLinks !== 'function') {
          continue
        }
        const originalProvideLinks = provider.provideLinks.bind(provider)
        provider.provideLinks = (bufferLineNumber, callback) => {
          originalProvideLinks(bufferLineNumber, (links) => {
            callback(links?.filter((link) => !isCorruptedOscLinkText(link.text)))
          })
        }
      }
    }
    terminal.parser?.registerOscHandler?.(8, (data) => isCorruptedOscLinkText(data))
  } catch {
    // Best-effort guard around xterm internals.
  }
}
