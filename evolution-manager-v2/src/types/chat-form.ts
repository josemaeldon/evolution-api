export type FormFieldType = "text" | "textarea" | "email" | "phone" | "number" | "date" | "select" | "checkbox";

export type FormField = {
  id: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  options?: string[];
};

export type ChatForm = {
  id: string;
  title: string;
  description: string | null;
  fields: FormField[];
  createdAt: string;
};

export type FormSubmission = {
  id: string;
  remoteJid: string;
  contactName: string;
  answers: Record<string, string | boolean>;
  fields: FormField[];
  createdAt: string;
};
