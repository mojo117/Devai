import type { SkillSummary } from '../../types';
import { PanelSection } from './PanelSection';

interface SkillsSectionProps {
  skills: SkillSummary[];
  selectedSkillIds: string[];
  skillsLoadedAt: string | null;
  skillsErrors: string[];
  onToggleSkill: (skillId: string) => void;
  onReloadSkills: () => void;
  skillsLoading: boolean;
}

export function SkillsSection({
  skills,
  selectedSkillIds,
  skillsLoadedAt,
  skillsErrors,
  onToggleSkill,
  onReloadSkills,
  skillsLoading,
}: SkillsSectionProps) {
  return (
    <PanelSection
      title="Skills"
      count={skills.length}
      loadedAt={skillsLoadedAt}
      loading={skillsLoading}
      onAction={onReloadSkills}
      actionLabel="Reload"
    >
      {skillsErrors.length > 0 && (
        <div className="mt-2 text-[10px] text-red-300 space-y-1">
          {skillsErrors.map((error) => (
            <div key={error}>{error}</div>
          ))}
        </div>
      )}
      {skills.length > 0 ? (
        <div className="mt-3 space-y-2">
          {skills.map((skill) => (
            <label
              key={skill.id}
              className="flex items-start gap-2 bg-gray-900 rounded p-2 text-xs text-gray-200"
            >
              <input
                type="checkbox"
                className="mt-0.5"
                checked={selectedSkillIds.includes(skill.id)}
                onChange={() => onToggleSkill(skill.id)}
              />
              <span>
                <span className="block font-semibold text-blue-300">{skill.name}</span>
                <span className="block text-[11px] text-gray-500">{skill.description}</span>
              </span>
            </label>
          ))}
        </div>
      ) : (
        <p className="text-xs text-gray-500 mt-2">
          No skills loaded. Add manifests under the skills folder.
        </p>
      )}
    </PanelSection>
  );
}
