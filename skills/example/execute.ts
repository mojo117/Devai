import type { SkillContext, SkillResult } from '@devai/shared';

export async function execute(
  args: Record<string, unknown>,
  ctx: SkillContext
): Promise<SkillResult> {
  const name = (args.name as string) || 'World';
  ctx.log(`Greeting ${name}`);

  return {
    success: true,
    result: { greeting: `Hello, ${name}!` },
  };
}
