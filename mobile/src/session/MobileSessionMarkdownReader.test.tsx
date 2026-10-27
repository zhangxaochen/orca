import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MarkdownReader } from './MobileSessionMarkdownReader'
import type { MarkdownDocState } from './mobile-session-route-types'

vi.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  ActivityIndicator: 'ActivityIndicator',
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 }
}))
vi.mock('lucide-react-native', () => ({
  RefreshCw: 'RefreshCw',
  ListOrdered: 'ListOrdered',
  Copy: 'Copy',
  Check: 'Check'
}))
vi.mock('../components/MobileRichMarkdownEditor', () => ({
  MobileRichMarkdownEditor: 'MobileRichMarkdownEditor'
}))
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }))
vi.mock('./mobile-session-styles', () => ({ styles: {} }))

const doc: MarkdownDocState = {
  status: 'ready',
  content: '# Saved',
  localContent: '# Saved',
  baseVersion: '1',
  isDirty: false,
  editable: true
}

describe('live session markdown reader copy', () => {
  let renderer: ReactTestRenderer | undefined
  const onCopy = vi.fn(),
    onCopyPath = vi.fn(),
    onSave = vi.fn(),
    onDiscard = vi.fn(),
    onRefresh = vi.fn()
  function render(value: MarkdownDocState | undefined = doc) {
    act(() => {
      renderer = create(
        createElement(MarkdownReader, {
          documentId: 'doc',
          doc: value,
          onCopy,
          onCopyPath,
          onSave,
          onDiscard,
          onRefresh,
          onChange: vi.fn(),
          keyboardLift: 0
        })
      )
    })
  }
  const buttons = () => renderer!.root.findAll((node) => String(node.type) === 'Pressable')
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => act(() => renderer?.unmount()))

  it.each([
    ['editable', {}],
    ['dirty', { isDirty: true, localContent: '# Unsaved' }],
    ['read-only', { editable: false }],
    ['saving', { isDirty: true, saving: true }],
    ['truncated', { truncated: true }]
  ] as const)(
    'offers adjacent source and path copy actions on a ready %s document',
    (_name, fields) => {
      render({ ...doc, ...fields })
      const copy = buttons().find(
        (node) =>
          node.props.accessibilityLabel ===
          ('truncated' in fields ? 'Copy loaded Markdown source' : 'Copy Markdown source')
      )
      expect(copy).toBeDefined()
      expect(buttons()[0]).toBe(copy)
      expect(copy?.props.accessibilityRole).toBe('button')
      expect(copy?.props.disabled).not.toBe(true)
      act(() => copy?.props.onPress())
      expect(onCopy).toHaveBeenCalledOnce()
      const pathCopy = buttons()[1]!
      expect(pathCopy.props.accessibilityLabel).toBe('Copy Markdown path')
      expect(pathCopy.props.accessibilityRole).toBe('button')
      expect(pathCopy.props.disabled).not.toBe(true)
      act(() => pathCopy.props.onPress())
      expect(onCopyPath).toHaveBeenCalledOnce()
      expect(onCopy).toHaveBeenCalledOnce()
      expect(onSave).not.toHaveBeenCalled()
      expect(onDiscard).not.toHaveBeenCalled()
    }
  )

  it('keeps loading and error states free of copy actions', () => {
    render({ status: 'loading' })
    expect(buttons()).toHaveLength(0)
    act(() =>
      renderer!.update(
        createElement(MarkdownReader, {
          documentId: 'doc',
          doc: { status: 'error', message: 'Unavailable' },
          onCopy,
          onCopyPath,
          onSave,
          onDiscard,
          onRefresh,
          onChange: vi.fn(),
          keyboardLift: 0
        })
      )
    )
    expect(buttons()).toHaveLength(1)
    act(() => buttons()[0]!.props.onPress())
    expect(onRefresh).toHaveBeenCalledOnce()
    expect(onCopy).not.toHaveBeenCalled()
    expect(onCopyPath).not.toHaveBeenCalled()
  })

  it('toggles between rich editor and source view with line numbers', () => {
    render(doc)
    const viewToggle = buttons().find(
      (node) => node.props.accessibilityLabel === 'View Markdown source'
    )
    expect(viewToggle).toBeDefined()
    expect(
      buttons().find(
        (node) =>
          node.props.accessibilityLabel === 'Show line numbers' ||
          node.props.accessibilityLabel === 'Hide line numbers'
      )
    ).toBeUndefined()

    act(() => viewToggle!.props.onPress())

    const lineToggle = buttons().find(
      (node) =>
        node.props.accessibilityLabel === 'Show line numbers' ||
        node.props.accessibilityLabel === 'Hide line numbers'
    )
    expect(lineToggle).toBeDefined()

    const richToggle = buttons().find(
      (node) => node.props.accessibilityLabel === 'View rich editor'
    )
    expect(richToggle).toBeDefined()
    act(() => {
      richToggle!.props.onPress()
    })

    expect(
      buttons().find(
        (node) => node.props.accessibilityLabel === 'View Markdown source'
      )
    ).toBeDefined()
  })

  it('renders top address bar with line number toggle, path, and copy in source view', () => {
    act(() => {
      renderer = create(
        createElement(MarkdownReader, {
          documentId: 'doc',
          doc,
          title: 'README.md',
          relativePath: 'docs/README.md',
          onCopy,
          onCopyPath,
          onSave,
          onDiscard,
          onRefresh,
          onChange: vi.fn(),
          keyboardLift: 0
        })
      )
    })
    const viewToggle = buttons().find(
      (node) => node.props.accessibilityLabel === 'View Markdown source'
    )
    act(() => viewToggle!.props.onPress())

    const sourceCopy = buttons().find(
      (node) => node.props.accessibilityLabel === 'Copy file content'
    )
    expect(sourceCopy).toBeDefined()

    const lineToggle = buttons().find(
      (node) =>
        node.props.accessibilityLabel === 'Show line numbers' ||
        node.props.accessibilityLabel === 'Hide line numbers'
    )
    expect(lineToggle).toBeDefined()

    const texts = renderer!.root.findAll((node) => String(node.type) === 'Text')
    const pathText = texts.find((node) => node.props.children === 'docs/README.md')
    expect(pathText).toBeDefined()
  })
})
