export interface SkillParameter {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required?: boolean;
  default?: unknown;
}

export interface SkillManifest {
  id: string;
  name: string;
  description: string;
  version?: string;
  parameters?: Record<string, SkillParameter>;
  createdBy?: string;
  tags?: string[];
}

export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  version?: string;
  tags?: string[];
}
