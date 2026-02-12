import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

const DEFAULT_TOOLTIP_SIZE = { width: 304, height: 140 }
const OFFSET_PX = 14
const VIEWPORT_PADDING_PX = 12
const HIGHLIGHT_PADDING_PX = 6

const PLACEMENTS = ['top', 'right', 'bottom', 'left']

function normalizePlacement(value) {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (PLACEMENTS.includes(normalized)) {
      return normalized
    }
  }
  return 'bottom'
}

function toComparableRect(rect) {
  return {
    top: rect.top,
    left: rect.left,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  }
}

function hasRectChanged(previous, next) {
  if (!previous || !next) {
    return true
  }
  return (
    Math.abs(previous.top - next.top) > 0.5 ||
    Math.abs(previous.left - next.left) > 0.5 ||
    Math.abs(previous.width - next.width) > 0.5 ||
    Math.abs(previous.height - next.height) > 0.5
  )
}

function clamp(value, min, max) {
  if (value < min) {
    return min
  }
  if (value > max) {
    return max
  }
  return value
}

function getPlacementOrder(preferred) {
  const normalized = normalizePlacement(preferred)
  return [normalized, ...PLACEMENTS.filter((placement) => placement !== normalized)]
}

function getPlacementCoordinates(placement, targetRect, tooltipSize) {
  switch (placement) {
    case 'top':
      return {
        top: targetRect.top - tooltipSize.height - OFFSET_PX,
        left: targetRect.left + targetRect.width / 2 - tooltipSize.width / 2,
      }
    case 'right':
      return {
        top: targetRect.top + targetRect.height / 2 - tooltipSize.height / 2,
        left: targetRect.right + OFFSET_PX,
      }
    case 'left':
      return {
        top: targetRect.top + targetRect.height / 2 - tooltipSize.height / 2,
        left: targetRect.left - tooltipSize.width - OFFSET_PX,
      }
    case 'bottom':
    default:
      return {
        top: targetRect.bottom + OFFSET_PX,
        left: targetRect.left + targetRect.width / 2 - tooltipSize.width / 2,
      }
  }
}

function fitsViewport(coords, tooltipSize, viewport) {
  return (
    coords.top >= VIEWPORT_PADDING_PX &&
    coords.left >= VIEWPORT_PADDING_PX &&
    coords.top + tooltipSize.height <= viewport.height - VIEWPORT_PADDING_PX &&
    coords.left + tooltipSize.width <= viewport.width - VIEWPORT_PADDING_PX
  )
}

function clampCoordinates(coords, tooltipSize, viewport) {
  const minTop = VIEWPORT_PADDING_PX
  const minLeft = VIEWPORT_PADDING_PX
  const maxTop = Math.max(viewport.height - tooltipSize.height - VIEWPORT_PADDING_PX, minTop)
  const maxLeft = Math.max(viewport.width - tooltipSize.width - VIEWPORT_PADDING_PX, minLeft)
  return {
    top: clamp(coords.top, minTop, maxTop),
    left: clamp(coords.left, minLeft, maxLeft),
  }
}

function arrowClassForPlacement(placement) {
  switch (placement) {
    case 'top':
      return '-bottom-[7px] left-1/2 -translate-x-1/2'
    case 'right':
      return '-left-[7px] top-1/2 -translate-y-1/2'
    case 'left':
      return '-right-[7px] top-1/2 -translate-y-1/2'
    case 'bottom':
    default:
      return '-top-[7px] left-1/2 -translate-x-1/2'
  }
}

export default function GuidedStepOverlay({
  currentStep,
  currentStepNumber,
  totalSteps,
}) {
  const [isClient, setIsClient] = useState(false)
  const [targetRect, setTargetRect] = useState(null)
  const [tooltipSize, setTooltipSize] = useState(DEFAULT_TOOLTIP_SIZE)

  const targetRef = useRef(null)
  const tooltipRef = useRef(null)
  const rafRef = useRef(0)
  const scrolledStepTokenRef = useRef('')

  const stepUi = currentStep?.ui
  const selector = typeof stepUi?.target === 'string' ? stepUi.target : null
  const preferredPlacement = normalizePlacement(stepUi?.placement)

  useEffect(() => {
    setIsClient(true)
  }, [])

  useLayoutEffect(() => {
    if (!isClient || !tooltipRef.current) {
      return undefined
    }

    const tooltipNode = tooltipRef.current
    const syncTooltipSize = () => {
      if (!tooltipNode.isConnected) {
        return
      }
      const rect = tooltipNode.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) {
        return
      }
      const nextSize = {
        width: rect.width,
        height: rect.height,
      }
      setTooltipSize((previousSize) => {
        if (
          Math.abs(previousSize.width - nextSize.width) <= 0.5 &&
          Math.abs(previousSize.height - nextSize.height) <= 0.5
        ) {
          return previousSize
        }
        return nextSize
      })
    }

    syncTooltipSize()
    if (typeof ResizeObserver === 'undefined') {
      return undefined
    }

    const observer = new ResizeObserver(() => {
      syncTooltipSize()
    })
    observer.observe(tooltipNode)

    return () => {
      observer.disconnect()
    }
  }, [
    isClient,
    currentStep?.id,
    currentStep?.title,
    currentStep?.description,
    currentStep?.ui?.title,
    currentStep?.ui?.body,
    currentStepNumber,
    totalSteps,
  ])

  useEffect(() => {
    if (!isClient || !selector) {
      targetRef.current = null
      setTargetRect((previousRect) => (previousRect ? null : previousRect))
      return undefined
    }

    const queryTarget = () => {
      try {
        return document.querySelector(selector)
      } catch {
        return null
      }
    }

    let observedTarget = null
    const targetResizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            scheduleMeasure()
          })
        : null
    const mutationObserver =
      typeof MutationObserver !== 'undefined'
        ? new MutationObserver(() => {
            scheduleMeasure()
          })
        : null

    const syncObservedTarget = (nextTarget) => {
      if (!targetResizeObserver || observedTarget === nextTarget) {
        return
      }
      if (observedTarget) {
        targetResizeObserver.unobserve(observedTarget)
      }
      observedTarget = nextTarget
      if (observedTarget) {
        targetResizeObserver.observe(observedTarget)
      }
    }

    const measure = () => {
      rafRef.current = 0
      const nextTarget = queryTarget()
      targetRef.current = nextTarget
      syncObservedTarget(nextTarget)

      if (!nextTarget || !nextTarget.isConnected) {
        setTargetRect((previousRect) => (previousRect ? null : previousRect))
        return
      }

      const nextRect = toComparableRect(nextTarget.getBoundingClientRect())
      if (nextRect.width <= 0 || nextRect.height <= 0) {
        setTargetRect((previousRect) => (previousRect ? null : previousRect))
        return
      }

      setTargetRect((previousRect) => (hasRectChanged(previousRect, nextRect) ? nextRect : previousRect))
    }

    const scheduleMeasure = () => {
      if (rafRef.current) {
        return
      }
      rafRef.current = window.requestAnimationFrame(() => {
        measure()
      })
    }

    scheduleMeasure()

    window.addEventListener('resize', scheduleMeasure)
    window.addEventListener('scroll', scheduleMeasure, { capture: true, passive: true })

    if (mutationObserver) {
      mutationObserver.observe(document.body, {
        childList: true,
        subtree: true,
      })
    }

    return () => {
      window.removeEventListener('resize', scheduleMeasure)
      window.removeEventListener('scroll', scheduleMeasure, true)
      if (rafRef.current) {
        window.cancelAnimationFrame(rafRef.current)
        rafRef.current = 0
      }
      if (targetResizeObserver) {
        if (observedTarget) {
          targetResizeObserver.unobserve(observedTarget)
        }
        targetResizeObserver.disconnect()
      }
      if (mutationObserver) {
        mutationObserver.disconnect()
      }
    }
  }, [isClient, selector])

  useEffect(() => {
    if (!targetRef.current || !targetRect || !stepUi?.scroll_into_view) {
      return
    }

    const stepToken = `${currentStep?.id || ''}:${selector || ''}`
    if (!stepToken || scrolledStepTokenRef.current === stepToken) {
      return
    }
    scrolledStepTokenRef.current = stepToken

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    targetRef.current.scrollIntoView({
      block: 'center',
      inline: 'nearest',
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
    })
  }, [currentStep?.id, selector, stepUi?.scroll_into_view, targetRect])

  const layout = useMemo(() => {
    if (!isClient || !targetRect) {
      return null
    }

    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight,
    }
    if (viewport.width <= 0 || viewport.height <= 0) {
      return null
    }

    const placements = getPlacementOrder(preferredPlacement)
    let resolvedPlacement = placements[0]
    let tooltipCoordinates = getPlacementCoordinates(resolvedPlacement, targetRect, tooltipSize)

    for (const placement of placements) {
      const candidate = getPlacementCoordinates(placement, targetRect, tooltipSize)
      if (fitsViewport(candidate, tooltipSize, viewport)) {
        resolvedPlacement = placement
        tooltipCoordinates = candidate
        break
      }
    }

    tooltipCoordinates = clampCoordinates(tooltipCoordinates, tooltipSize, viewport)

    const highlightTop = clamp(targetRect.top - HIGHLIGHT_PADDING_PX, 0, viewport.height)
    const highlightLeft = clamp(targetRect.left - HIGHLIGHT_PADDING_PX, 0, viewport.width)
    const highlightBottom = clamp(targetRect.bottom + HIGHLIGHT_PADDING_PX, 0, viewport.height)
    const highlightRight = clamp(targetRect.right + HIGHLIGHT_PADDING_PX, 0, viewport.width)

    return {
      resolvedPlacement,
      tooltipCoordinates,
      highlightStyle: {
        top: highlightTop,
        left: highlightLeft,
        width: Math.max(highlightRight - highlightLeft, 0),
        height: Math.max(highlightBottom - highlightTop, 0),
      },
    }
  }, [isClient, preferredPlacement, targetRect, tooltipSize])

  if (!isClient || !selector || !currentStep || !layout) {
    return null
  }

  const title = stepUi?.title || currentStep.title
  const body = stepUi?.body || currentStep.description
  const showArrow = stepUi?.arrow !== false

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[95]" aria-hidden>
      <div
        className="absolute rounded-xl border-2 border-amber-500/80 bg-amber-500/10 shadow-[0_0_0_9999px_rgba(15,23,42,0.22)] transition-all duration-200"
        style={layout.highlightStyle}
      />
      <div
        ref={tooltipRef}
        className="absolute w-[304px] max-w-[calc(100vw-1.5rem)] rounded-xl border border-amber-500/40 bg-card/95 px-3 py-2.5 shadow-2xl backdrop-blur"
        style={layout.tooltipCoordinates}
      >
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-amber-600">
          Step {currentStepNumber} of {totalSteps}
        </p>
        {title && <p className="mt-1 text-sm font-semibold leading-tight text-foreground">{title}</p>}
        {body && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{body}</p>}
        {showArrow && (
          <span
            className={cn(
              'absolute h-3.5 w-3.5 rotate-45 border border-amber-500/40 bg-card/95',
              arrowClassForPlacement(layout.resolvedPlacement)
            )}
          />
        )}
      </div>
    </div>,
    document.body
  )
}
