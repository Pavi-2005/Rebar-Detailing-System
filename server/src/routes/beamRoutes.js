import express from 'express';
import { createBeamDesign } from '../controllers/beamController.js';

const router = express.Router();

router.post('/design', createBeamDesign);

export default router;
