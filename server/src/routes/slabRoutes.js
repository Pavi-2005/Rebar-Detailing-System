import express from 'express';
import { createSlabDesign } from '../controllers/slabController.js';

const router = express.Router();

router.post('/design', createSlabDesign);

export default router;
