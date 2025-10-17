// apps/web/src/lib/types.ts
export type FormFieldType = "text" | "number" | "boolean" | "select";

export type FormField = {
  key: string;
  label: string;
  type: FormFieldType;
  required?: boolean;
  options?: string[]; // para select
  min?: number;
  max?: number;
  help?: string;
  order?: number;
};

export type FormDoc = {
  _id?: string;
  typeId: string;
  name: string;
  version: number;
  isActive: boolean;
  fields: FormField[];
  createdAt: string;
  publishedAt?: string | null;
};

export type DeviceType = { id: string; name: string };
export type DeviceModel = { typeId: string; brand: string; model: string; year?: number; extId?: string };