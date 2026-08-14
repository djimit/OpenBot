/** Structured assistant output rendered as safe, actionable transcript cards. */
export type RichCardSpec =
  | { type: 'email-draft'; to: string[]; cc?: string[]; subject: string; body: string }
  | { type: 'message-draft'; service: string; channel?: string; body: string }
  | { type: 'link'; title: string; description?: string; url: string }
