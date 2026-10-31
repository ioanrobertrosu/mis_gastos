import { type Static, Type } from '@sinclair/typebox';

/** Parámetros de ruta `/:id`: se valida el UUID antes de llegar a Prisma. */
export const IdParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
});

export type IdParams = Static<typeof IdParamsSchema>;
