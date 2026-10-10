import { generateFootingDesign } from '../services/footingCalculationService.js';
import SlabDesign from '../models/SlabDesign.js';

export async function createFootingDesign(req, res) {
  try {
    const result = generateFootingDesign(req.body);
    if (req.user) await new SlabDesign({ ownerId: req.user.id, user: { email: req.user.email, name: req.user.name }, projectName: req.body.projectName, designType: 'Footing', inputValues: req.body, result, createdAt: new Date() }).save();
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
}
