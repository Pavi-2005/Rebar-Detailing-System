import SlabDesign from '../models/SlabDesign.js';
import { ownedDesignFilter } from '../utils/ownedDesignFilter.js';

export async function getHistory(req, res) {
  try {
    const records = await SlabDesign.find(ownedDesignFilter(req.user)).sort({ createdAt: -1 });
    res.json(records);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

export async function deleteHistory(req, res) {
  try {
    const { id } = req.params;
    await SlabDesign.deleteOne({ _id: id, ...ownedDesignFilter(req.user) });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
