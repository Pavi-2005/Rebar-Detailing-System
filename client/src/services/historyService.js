import api from './api';

export async function fetchHistory() {
  const response = await api.get('/history');
  return response.data;
}

export async function deleteHistoryEntry(id) {
  await api.delete(`/history/${id}`);
}
