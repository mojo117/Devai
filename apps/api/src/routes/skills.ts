import { FastifyPluginAsync } from 'fastify';
import {
  getSkillById,
  getSkillLoadState,
  getSkillSummaries,
  refreshSkills,
} from '../skills/registry.js';

export const skillsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/skills', async () => {
    const state = getSkillLoadState();

    if (!state.loadedAt) {
      await refreshSkills();
    }

    return {
      skills: getSkillSummaries(),
      ...getSkillLoadState(),
    };
  });

  app.get('/skills/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const skill = getSkillById(id);

    if (!skill) {
      return reply.status(404).send({ error: 'Skill not found' });
    }

    return { skill };
  });

  app.post('/skills/reload', async () => {
    return refreshSkills();
  });
};
