
import { forwardRef } from "react"
import { Slot } from "@radix-ui/react-slot"

import { cn } from "@/lib/utils"
import { buttonVariants } from "./button-variants"

const Button = forwardRef(function Button(
  {
    className,
    variant,
    size,
    asChild = false,
    ...props
  },
  ref
) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      ref={ref}
      {...props} />
  );
})

export { Button }
