import { useEffect, useMemo, useRef } from 'react'
import { ScrollView, Text, View } from 'react-native'
import { MobileSyntaxSegments } from '../components/MobileSyntaxSegments'
import type { MobileSyntaxSegment } from '../session/mobile-file-syntax'
import { formatPreviewByteLength } from './mobile-file-preview-request'
import { scrollOffsetForPreviewLine } from './mobile-file-preview-line-column'
import { buildMobileFilePreviewSyntax } from './mobile-file-preview-syntax'
import { filePreviewStyles as styles } from './mobile-file-preview-styles'

export function splitSyntaxSegmentsIntoLines(
  segments: readonly MobileSyntaxSegment[]
): MobileSyntaxSegment[][] {
  const lines: MobileSyntaxSegment[][] = [[]]
  for (const segment of segments) {
    const parts = segment.text.split('\n')
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) {
        lines.push([])
      }
      const partText = parts[i]
      if (partText.length > 0) {
        lines[lines.length - 1].push({ text: partText, kind: segment.kind })
      }
    }
  }
  return lines
}

export function MobileFilePreviewSourceText({
  relativePath,
  content,
  truncated,
  byteLength,
  initialLine,
  showLineNumbers = true
}: {
  relativePath: string
  content: string
  truncated?: boolean
  byteLength?: number
  initialLine?: number
  showLineNumbers?: boolean
}) {
  const scrollRef = useRef<ScrollView>(null)
  const revealedRef = useRef(false)
  const syntax = useMemo(
    () => buildMobileFilePreviewSyntax(relativePath, content),
    [content, relativePath]
  )

  const lines = useMemo(
    () => (showLineNumbers ? splitSyntaxSegmentsIntoLines(syntax.segments) : null),
    [showLineNumbers, syntax.segments]
  )

  const lineNumberWidth = useMemo(() => {
    if (!lines) {
      return 28
    }
    const digits = Math.max(1, String(lines.length).length)
    return Math.max(28, digits * 8 + 8)
  }, [lines])

  useEffect(() => {
    revealedRef.current = false
  }, [content, initialLine, relativePath])

  const revealInitialLine = () => {
    if (!initialLine || revealedRef.current) {
      return
    }
    revealedRef.current = true
    scrollRef.current?.scrollTo({
      y: scrollOffsetForPreviewLine(initialLine),
      animated: false
    })
  }

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.scroll}
      contentContainerStyle={styles.textContent}
      onContentSizeChange={revealInitialLine}
    >
      {truncated ? (
        <MobileFilePreviewTruncatedNote byteLength={byteLength ?? content.length} />
      ) : null}
      {showLineNumbers && lines ? (
        <View style={styles.sourceLinesContainer} accessibilityLabel="File preview">
          {lines.map((lineSegments, lineIndex) => (
            <View key={lineIndex} style={styles.sourceLineRow}>
              <Text
                style={[styles.sourceLineNumber, { width: lineNumberWidth }]}
                accessibilityElementsHidden
                importantForAccessibility="no"
              >
                {lineIndex + 1}
              </Text>
              <Text selectable style={styles.sourceLineText}>
                {lineSegments.length > 0 ? (
                  <MobileSyntaxSegments segments={lineSegments} />
                ) : (
                  ' '
                )}
              </Text>
            </View>
          ))}
        </View>
      ) : (
        <Text selectable style={styles.textPreview} accessibilityLabel="File preview">
          <MobileSyntaxSegments segments={syntax.segments} />
        </Text>
      )}
    </ScrollView>
  )
}

export function MobileFilePreviewTruncatedNote({ byteLength }: { byteLength: number }) {
  return (
    <Text style={styles.truncatedNote}>
      Preview truncated. File size: {formatPreviewByteLength(byteLength)}.
    </Text>
  )
}
