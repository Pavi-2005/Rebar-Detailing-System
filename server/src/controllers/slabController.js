import { generateSlabDesign } from '../services/slabCalculationService.js';
import SlabDesign from '../models/SlabDesign.js';

export async function createSlabDesign(req, res) {
  try {
    const result = generateSlabDesign(req.body);
    const designDoc = new SlabDesign({
      ownerId: req.user.id,
      user: { email: req.user.email, name: req.user.name },
      projectName: req.body.projectName,
      designType: 'Slab',
      inputValues: req.body,
      result,
      createdAt: new Date()
    });
    await designDoc.save();
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
}
