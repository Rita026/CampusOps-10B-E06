import { render, waitFor } from '@testing-library/react-native';

import App from '../App';

jest.mock('../src/api/courseBackend', () => ({
  getBackendHealth: jest.fn().mockResolvedValue({
    ok: true,
    service: 'dmi-controlled-backend',
    contractVersion: 1,
  }),
}));

jest.mock('../src/infrastructure/incidents/CourseIncidentClient', () => ({
  CourseIncidentClient: jest.fn().mockImplementation(() => ({
    list: jest.fn().mockResolvedValue({ ok: true, value: [] }),
    getById: jest.fn().mockResolvedValue({ ok: true, value: null }),
    create: jest.fn().mockResolvedValue({ ok: true, value: null }),
  })),
}));

test('renders the reproducible baseline and resolves backend state', async () => {
  const view = await render(<App />);
  expect(view.getByText('CampusOps')).toBeTruthy();
  await waitFor(() => expect(view.getByTestId('backend-status').props.children.join('')).toContain('available'));
});