"use client"

import XIcon from 'lucide-react/dist/esm/icons/x.js';
import { forwardRef } from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"

import { cn } from "@/lib/utils"

const Dialog = forwardRef((props, ref) => {
  return <DialogPrimitive.Root data-slot="dialog" {...props} ref={ref} />;
});
Dialog.displayName = "Dialog";

const DialogTrigger = forwardRef((props, ref) => {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} ref={ref} />;
});
DialogTrigger.displayName = "DialogTrigger";

const DialogPortal = forwardRef((props, ref) => {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} ref={ref} />;
});
DialogPortal.displayName = "DialogPortal";

const DialogClose = forwardRef((props, ref) => {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} ref={ref} />;
});
DialogClose.displayName = "DialogClose";

const DialogOverlay = forwardRef(({ className, ...props }, ref) => {
  return (
      <DialogPrimitive.Overlay
          data-slot="dialog-overlay"
          className={cn(
              "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50",
              className
          )}
          {...props}
          ref={ref} />
  );
});
DialogOverlay.displayName = "DialogOverlay";

const DialogContent = forwardRef(({ className, children, ...props }, ref) => {
  return (
      <DialogPortal data-slot="dialog-portal">
        <DialogOverlay />
        <DialogPrimitive.Content
            data-slot="dialog-content"
            className={cn(
                "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border p-6 shadow-lg duration-200 sm:max-w-lg",
                className
            )}
            {...props}
            ref={ref}>
          {children}
          <DialogPrimitive.Close
              className="ring-offset-background focus:ring-ring data-[state=open]:bg-accent data-[state=open]:text-muted-foreground absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4">
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPortal>
  );
});
DialogContent.displayName = "DialogContent";

const DialogHeader = forwardRef(({ className, ...props }, ref) => {
  return (
      <div
          data-slot="dialog-header"
          className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
          {...props}
          ref={ref} />
  );
});
DialogHeader.displayName = "DialogHeader";

const DialogFooter = forwardRef(({ className, ...props }, ref) => {
  return (
      <div
          data-slot="dialog-footer"
          className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
          {...props}
          ref={ref} />
  );
});
DialogFooter.displayName = "DialogFooter";

const DialogTitle = forwardRef(({ className, ...props }, ref) => {
  return (
      <DialogPrimitive.Title
          data-slot="dialog-title"
          className={cn("text-lg leading-none font-semibold", className)}
          {...props}
          ref={ref} />
  );
});
DialogTitle.displayName = "DialogTitle";

const DialogDescription = forwardRef(({ className, ...props }, ref) => {
  return (
      <DialogPrimitive.Description
          data-slot="dialog-description"
          className={cn("text-muted-foreground text-sm", className)}
          {...props}
          ref={ref} />
  );
});
DialogDescription.displayName = "DialogDescription";

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}