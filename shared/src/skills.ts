export interface SkillManifest {
  id: string;
  name: string;
  description: string;
  version?: string;
  systemPrompt?: string;
  toolAllowList?: string[];
  tags?: string[];
}

export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  version?: string;
  tags?: string[];
}
