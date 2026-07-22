'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { getFunctions, httpsCallable, type FunctionsError } from 'firebase/functions';

import {
  quoteRequestSchema,
  type QuoteRequestInput,
  type ProductId,
  type Unit,
} from '@/lib/schemas';
import { app } from '@/lib/firebase';

interface SubmitResult {
  reference: string;
  ok: boolean;
  freight?: string;
}

export function useQuoteForm(defaults: { product: ProductId; unit: Unit; quantity: number }) {
  const [reference, setReference] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<QuoteRequestInput>({
    resolver: zodResolver(quoteRequestSchema),
    mode: 'onBlur',
    defaultValues: {
      ...defaults,
      name: '',
      email: '',
      phone: '',
      postcode: '',
      notes: '',
      company_website: '',
    },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      const fn = httpsCallable<QuoteRequestInput, SubmitResult>(
        getFunctions(app, 'australia-southeast1'),
        'submitQuote'
      );
      const { data } = await fn(values);
      setReference(data.reference);
      form.reset();
    } catch (err) {
      const e = err as FunctionsError;

      // Map server field errors back onto the form.
      const fieldErrors = (e.details as { fieldErrors?: Record<string, string[]> })
        ?.fieldErrors;
      if (fieldErrors) {
        Object.entries(fieldErrors).forEach(([key, messages]) => {
          form.setError(key as keyof QuoteRequestInput, {
            message: messages[0],
          });
        });
        return;
      }

      setServerError(
        e.code === 'functions/resource-exhausted'
          ? e.message
          : "That didn't send. Try again, or call 0477 425 258."
      );
    }
  });

  return {
    form,
    onSubmit,
    reference,
    serverError,
    isSubmitting: form.formState.isSubmitting,
    reset: () => {
      setReference(null);
      setServerError(null);
    },
  };
}
