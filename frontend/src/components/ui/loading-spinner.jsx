import { cn } from "@/lib/utils"

const HEART_PULSE_POINTS =
  "0,45.486 38.514,45.486 44.595,33.324 50.676,45.486 57.771,45.486 62.838,55.622 71.959,9 80.067,63.729 84.122,45.486 97.297,45.486 103.379,40.419 110.473,45.486 150,45.486"

const SIZE_CLASS_MAP = {
  "size-3": "h-3 w-6",
  "size-3.5": "h-3.5 w-7",
  "size-4": "h-4 w-8",
  "size-5": "h-5 w-10",
  "size-6": "h-6 w-12",
  "size-8": "h-8 w-16",
}

function normalizeSpinnerClassName(className) {
  if (typeof className !== "string") {
    return className
  }

  const retainedClasses = []
  let mappedSizeClass = null

  for (const classNamePart of className.split(/\s+/)) {
    if (!classNamePart) {
      continue
    }

    if (SIZE_CLASS_MAP[classNamePart]) {
      mappedSizeClass = SIZE_CLASS_MAP[classNamePart]
      continue
    }

    retainedClasses.push(classNamePart)
  }

  const hasExplicitDimensions = retainedClasses.some((classNamePart) => (
    classNamePart.startsWith("h-") ||
    classNamePart.startsWith("w-") ||
    classNamePart.startsWith("min-h-") ||
    classNamePart.startsWith("min-w-") ||
    classNamePart.startsWith("max-h-") ||
    classNamePart.startsWith("max-w-") ||
    classNamePart.startsWith("size-")
  ))

  return cn(
    !mappedSizeClass && !hasExplicitDimensions && "h-4 w-8",
    mappedSizeClass,
    retainedClasses,
  )
}

export function LoadingSpinner({
  className,
  title,
  ...props
}) {
  const ariaLabel = props["aria-label"]
  const ariaHidden = props["aria-hidden"] ?? (!ariaLabel && !title)
  const visibleToAssistiveTech = !ariaHidden && (ariaLabel || title)
  const svgProps = { ...props }

  delete svgProps["aria-label"]
  delete svgProps["aria-hidden"]

  return (
    <svg
      viewBox="0 0 128 64"
      className={cn("loading-spinner shrink-0", normalizeSpinnerClassName(className))}
      data-slot="loading-spinner"
      role={visibleToAssistiveTech ? "img" : undefined}
      aria-label={visibleToAssistiveTech ? ariaLabel : undefined}
      aria-hidden={ariaHidden}
      focusable="false"
      {...svgProps}
    >
      {title ? <title>{title}</title> : null}
      <polyline
        points={HEART_PULSE_POINTS}
        className="loading-spinner__line loading-spinner__back"
      />
      <polyline
        points={HEART_PULSE_POINTS}
        className="loading-spinner__line loading-spinner__front"
      />
    </svg>
  )
}
