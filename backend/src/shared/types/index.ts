import { z } from 'zod';

export const ProcessSchema = z.object({
  cnjNumber: z.string().regex(/^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$/, "Número CNJ inválido"),
  filingDate: z.date().optional(),
  classId: z.string().optional(),
  className: z.string().optional(),
  subjectCode: z.string().optional(),
  subjectName: z.string().optional(),
  dataSourceId: z.string().uuid(),
  courtId: z.string().uuid().optional(),
  judgingBodyId: z.string().uuid().optional(),
});

export type ProcessType = z.infer<typeof ProcessSchema>;

export const MovementSchema = z.object({
  processId: z.string().uuid(),
  date: z.date(),
  code: z.string().optional(),
  description: z.string().min(1)
});

export type MovementType = z.infer<typeof MovementSchema>;

export * from '../constants/jurisdiction';
export * from '../adapters/legal-adapter.interface';
export * from '../adapters/datajud.adapter';
