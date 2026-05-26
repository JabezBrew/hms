import {useId, useContext, createContext, forwardRef, useMemo} from "react";
import { Slot } from "@radix-ui/react-slot"
import { Controller, FormProvider, useFormContext, useFormState } from "react-hook-form";

import { cn } from "@/lib/utils"
import { Label } from "@/components/ui/label"

const Form = FormProvider

const FormFieldContext = createContext({})

const FormField = forwardRef(function FormField(
  {
    ...props
  },
  ref
) {
  const contextValue = useMemo(() => ({ name: props.name }), [props.name])

  return (
    <FormFieldContext.Provider value={contextValue}>
      <Controller {...props} ref={ref} />
    </FormFieldContext.Provider>
  );
})

const useFormField = () => {
  const fieldContext = useContext(FormFieldContext)
  const itemContext = useContext(FormItemContext)
  const { getFieldState } = useFormContext()
  const formState = useFormState({ name: fieldContext.name })
  const fieldState = getFieldState(fieldContext.name, formState)

  if (!fieldContext) {
    throw new Error("useFormField should be used within <FormField>")
  }

  const { id } = itemContext

  return {
    id,
    name: fieldContext.name,
    formItemId: `${id}-form-item`,
    formDescriptionId: `${id}-form-item-description`,
    formMessageId: `${id}-form-item-message`,
    ...fieldState,
  }
}

const FormItemContext = createContext({})

const FormItem = forwardRef(function FormItem({
  className,
  ...props
}, ref) {
  const id = useId()
  const contextValue = useMemo(() => ({ id }), [id])

  return (
    <FormItemContext.Provider value={contextValue}>
      <div data-slot="form-item" className={cn("grid gap-2", className)} ref={ref} {...props} />
    </FormItemContext.Provider>
  );
})

const FormLabel = forwardRef(function FormLabel({
  className,
  ...props
}, ref) {
  const { error, formItemId } = useFormField()

  return (
    <Label
      data-slot="form-label"
      data-error={!!error}
      className={cn("data-[error=true]:text-destructive", className)}
      htmlFor={formItemId}
      ref={ref}
      {...props} />
  );
})

const FormControl = forwardRef(function FormControl({
  ...props
}, ref) {
  const { error, formItemId, formDescriptionId, formMessageId } = useFormField()

  return (
    <Slot
      data-slot="form-control"
      id={formItemId}
      aria-describedby={
        !error
          ? `${formDescriptionId}`
          : `${formDescriptionId} ${formMessageId}`
      }
      aria-invalid={!!error}
      ref={ref}
      {...props} />
  );
})

const FormDescription = forwardRef(function FormDescription({
  className,
  ...props
}, ref) {
  const { formDescriptionId } = useFormField()

  return (
    <p
      data-slot="form-description"
      id={formDescriptionId}
      className={cn("text-muted-foreground text-sm", className)}
      ref={ref}
      {...props} />
  );
})

const FormMessage = forwardRef(function FormMessage({
  className,
  ...props
}, ref) {
  const { error, formMessageId } = useFormField()
  const body = error ? String(error?.message ?? "") : props.children

  if (!body) {
    return null
  }

  return (
    <p
      data-slot="form-message"
      id={formMessageId}
      className={cn("text-destructive text-sm", className)}
      ref={ref}
      {...props}>
      {body}
    </p>
  );
})

export {
  useFormField,
  Form,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
  FormField,
}
