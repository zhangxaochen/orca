import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import type {
  MobileWebShellBridgeMessagePayload,
  OrcaMobileWebShellViewHandle
} from '../../modules/orca-mobile-web-shell/src'
import { subscribeMirroredKey } from '../storage/mirrored-storage-keys'
import { useHostClient } from '../transport/host-client-hooks'
import { frameWithoutHostLine } from './shell-bridge-log-lines'
import { recordShellLifecycleLine } from './shell-lifecycle-line-recorder'
import type { BridgeInitRoute } from './bridge/bridge-envelope'
import type { BridgeClearableRouteParam } from './bridge/bridge-route-update'
import type { BridgeSafeAreaInsets } from './bridge/bridge-safe-area-insets'
import type { BridgeHapticsKind } from './bridge/bridge-haptics-notify'
import type { BridgeHost } from './bridge-host'
import type { BridgeSessionBack } from './bridge-host-back'
import type { BridgeNavigateBackOutcome } from './bridge-host-contract'
import type { BridgeNativeVerb } from './bridge/bridge-native-verbs'
import type { BridgeErrorCapture } from './bridge/bridge-error-capture'
import type { MobileWebShellSessionState } from './mobile-web-shell-session-contract'
import type { PageHostSnapshot } from './use-page-host-snapshot'
import { pageStorageKeysForRoute, type PageStorageForInit } from './page-storage-keys'
import {
  acquireRetainedOrCreateBridgeHost,
  postToMountedBridgeView,
  releaseOrParkBridgeHost,
  resetBridgeDocumentBindings,
  type MountedBridgeView
} from './retained-bridge-host-lifecycle'
import {
  flushRetainedBridgeFrames,
  type RetainedBridgeHostBinding
} from './retained-shell-session-store'

type MountedHost = { sessionId: string; host: BridgeHost }
type EstablishedBack = { sessionId: string; back: BridgeSessionBack }

export type MobileWebShellBridgeMessageEvent = {
  readonly nativeEvent: MobileWebShellBridgeMessagePayload
}

export type MobileWebShellBridgeView = {
  // Keep bridgeEnabled tied to ready, not client arrival: toggling it reloads native. Without a client, let the page retry ready until a host can answer.
  readonly bridgeEnabled: boolean
  readonly viewRef: (handle: OrcaMobileWebShellViewHandle | null) => void
  readonly onBridgeMessage: (event: MobileWebShellBridgeMessageEvent) => void
  // Without a host, drop updates; host construction reads the latest route.
  readonly publishRoute: (route: BridgeInitRoute) => void
  readonly publishSafeAreaInsets: (insets: BridgeSafeAreaInsets) => void
  readonly publishKeyboardInset: (height: number) => void
  // Return false if no host/document can take Back so the navigator keeps the press.
  readonly sendBack: () => boolean
}

export type MobileWebShellBridgeArgs = {
  hostId: string
  session: MobileWebShellSessionState
  // Handshake belongs to the reducer’s session; client replacement rebuilds the host under the same document without a new ready.
  sessionEstablished: boolean
  route: BridgeInitRoute
  safeAreaInsets: BridgeSafeAreaInsets
  keyboardInset: number
  pageRoutes: readonly string[]
  pageRouteGrants: readonly { pathname: string; grants: readonly string[] }[]
  // Effective session grants include the served-route union when this page owns the host area.
  routeGrants: readonly string[]
  ownsHostArea?: boolean
  onNavigate: (href: string) => void
  onExternalLink: (url: string) => void
  onHaptic: (kind: BridgeHapticsKind) => void
  serveNativeVerb: (verb: BridgeNativeVerb, params: unknown) => Promise<unknown>
  onNavigateBack: () => BridgeNavigateBackOutcome
  // Wait for host profile and storage before building the host, or its first init would mount a page against missing identity/preferences.
  snapshot: PageHostSnapshot | null
  readStorage: () => PageStorageForInit
  onStorageWrite: (key: string, value: string | null) => void
  onPageFault: (error: BridgeErrorCapture) => void
  onPageReady: () => void
  onPagePainted: () => void
  // Document resets explicitly publish false so retired pages cannot retain Back.
  onPageBackClaim: (claimed: boolean) => void
  onRouteParamClear: (param: BridgeClearableRouteParam, value: string) => void
  onRouteRefused: (issue: string) => void
  onBinaryFramesDropped: (total: number) => void
}

// Use reducer-owned session ids for the bridge; remount ids let native origin checks reject retired-document frames.
export function useMobileWebShellBridge(args: MobileWebShellBridgeArgs): MobileWebShellBridgeView {
  const { client, clientId } = useHostClient(args.hostId)
  const ready = args.session.kind === 'ready' ? args.session : null
  const sessionId = ready?.sessionId ?? null
  const buildId = ready?.buildId ?? null
  const viewRef = useRef<MountedBridgeView | null>(null)
  const hostRef = useRef<MountedHost | null>(null)
  const bindingRef = useRef<RetainedBridgeHostBinding | null>(null)
  const establishedBackRef = useRef<EstablishedBack | null>(null)
  const argsRef = useRef(args)
  const clientIdRef = useRef(clientId)
  const clientRef = useRef(client)
  const droppedFrameLoggedRef = useRef<string | null>(null)
  const writingFromPageRef = useRef(false)
  useLayoutEffect(() => {
    argsRef.current = args
    clientIdRef.current = clientId
    clientRef.current = client
    if (bindingRef.current !== null) {
      bindingRef.current.args = args
      bindingRef.current.clientId = clientId
    }
  })
  const hasSnapshot = args.snapshot !== null

  useLayoutEffect(() => {
    const currentSnapshot = argsRef.current.snapshot
    if (client === null || sessionId === null || buildId === null || currentSnapshot === null) {
      return
    }
    const { host, binding } = acquireRetainedOrCreateBridgeHost({
      client,
      buildId,
      sessionId,
      snapshot: currentSnapshot,
      latest: argsRef.current,
      clientId: clientIdRef.current,
      sessionBack:
        establishedBackRef.current?.sessionId === sessionId
          ? establishedBackRef.current.back
          : undefined,
      readMountedView: () => viewRef.current,
      setWritingFromPage: (writing) => {
        writingFromPageRef.current = writing
      }
    })
    bindingRef.current = binding
    hostRef.current = { sessionId, host }
    return () => {
      establishedBackRef.current = { sessionId, back: host.readSessionBack() }
      hostRef.current = null
      if (bindingRef.current === binding) {
        bindingRef.current = null
      }
      releaseOrParkBridgeHost({
        hostId: argsRef.current.hostId,
        sessionId,
        buildId,
        client,
        host,
        binding
      })
    }
  }, [buildId, client, hasSnapshot, sessionId])

  const wasEstablishedRef = useRef<{ sessionId: string | null; established: boolean }>({
    sessionId,
    established: args.sessionEstablished
  })
  useLayoutEffect(() => {
    const previous = wasEstablishedRef.current
    wasEstablishedRef.current = { sessionId, established: args.sessionEstablished }
    if (previous.sessionId === sessionId && previous.established && !args.sessionEstablished) {
      establishedBackRef.current = null
      resetBridgeDocumentBindings(
        bindingRef.current,
        hostRef.current?.sessionId === sessionId ? hostRef.current.host : null
      )
    }
  }, [args.sessionEstablished, sessionId])

  useEffect(() => {
    const keys = pageStorageKeysForRoute(args.hostId, args.route.pathname)
    const unsubscribes = keys.map((key) =>
      subscribeMirroredKey(key, () => {
        if (!writingFromPageRef.current && hostRef.current?.sessionId === sessionId) {
          hostRef.current.host.publishStorage()
        }
      })
    )
    return () => {
      for (const unsubscribe of unsubscribes) {
        unsubscribe()
      }
    }
  }, [args.hostId, args.route.pathname, buildId, client, hasSnapshot, sessionId])

  return {
    bridgeEnabled: ready !== null,
    viewRef: useCallback(
      (handle: OrcaMobileWebShellViewHandle | null) => {
        viewRef.current = handle === null || sessionId === null ? null : { sessionId, handle }
        if (handle === null || sessionId === null) {
          if (bindingRef.current !== null) {
            bindingRef.current.post = null
          }
          return
        }
        if (bindingRef.current !== null) {
          flushRetainedBridgeFrames(bindingRef.current, (json) =>
            postToMountedBridgeView(viewRef.current, sessionId, json)
          )
        }
      },
      [sessionId]
    ),
    onBridgeMessage: useCallback(
      (event: MobileWebShellBridgeMessageEvent) => {
        const mounted = hostRef.current
        if (mounted === null || mounted.sessionId !== sessionId) {
          if (
            mounted === null &&
            sessionId !== null &&
            droppedFrameLoggedRef.current !== sessionId
          ) {
            droppedFrameLoggedRef.current = sessionId
            recordShellLifecycleLine(
              argsRef.current.hostId,
              frameWithoutHostLine({
                clientReady: clientRef.current !== null,
                snapshotReady: argsRef.current.snapshot !== null
              })
            )
          }
          return
        }
        mounted.host.receive(event.nativeEvent.json)
      },
      [sessionId]
    ),
    // Fence updates by session and change callback identity with all host inputs; callers must retry after late host construction, whose layout effect runs first.
    publishRoute: useCallback(
      (route: BridgeInitRoute) => {
        const mounted = hostRef.current
        if (mounted !== null && mounted.sessionId === sessionId) {
          mounted.host.publishRoute(route)
        }
      },
      [buildId, client, hasSnapshot, sessionId]
    ),
    publishSafeAreaInsets: useCallback(
      (insets: BridgeSafeAreaInsets) => {
        const mounted = hostRef.current
        if (mounted !== null && mounted.sessionId === sessionId) {
          mounted.host.publishSafeAreaInsets(insets)
        }
      },
      [buildId, client, hasSnapshot, sessionId]
    ),
    publishKeyboardInset: useCallback(
      (height: number) => {
        const mounted = hostRef.current
        if (mounted !== null && mounted.sessionId === sessionId) {
          mounted.host.publishKeyboardInset(height)
        }
      },
      [buildId, client, hasSnapshot, sessionId]
    ),
    // Keep the session fence and return false when forwarding is unavailable so hardware Back falls through to navigation.
    sendBack: useCallback(() => {
      const mounted = hostRef.current
      return mounted !== null && mounted.sessionId === sessionId && mounted.host.sendBack()
    }, [sessionId])
  }
}
