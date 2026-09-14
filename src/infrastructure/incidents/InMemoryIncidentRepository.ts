import type { Incident, IncidentRepository } from '../../domain/incidents/Incident';

export const fakeIncidents: readonly Incident[] = [
  {
    id: 'INC-102',
    title: 'Luminaria apagada en el pasillo B',
    description: 'La luminaria junto al laboratorio de redes no enciende desde el turno matutino.',
    category: 'electrical',
    priority: 'medium',
    status: 'assigned',
    reporterLabel: 'Reportante ficticio 01',
    locationLabel: 'Edificio B · Pasillo norte',
    assignedTechnicianLabel: 'Técnica ficticia Ana',
    createdAt: '2026-09-08T09:15:00-06:00',
  },
  {
    id: 'INC-103',
    title: 'Fuga de agua en sanitario',
    description: 'Se observa goteo constante en el lavabo del sanitario del edificio C.',
    category: 'water',
    priority: 'high',
    status: 'in_progress',
    reporterLabel: 'Reportante ficticio 02',
    locationLabel: 'Edificio C · Planta baja',
    assignedTechnicianLabel: 'Técnico ficticio Luis',
    createdAt: '2026-09-08T11:40:00-06:00',
  },
  {
    id: 'INC-104',
    title: 'Proyector sin señal en aula 12',
    description: 'El proyector enciende, pero no recibe señal del equipo de presentación.',
    category: 'laboratory',
    priority: 'low',
    status: 'open',
    reporterLabel: 'Reportante ficticio 03',
    locationLabel: 'Edificio A · Aula 12',
    assignedTechnicianLabel: null,
    createdAt: '2026-09-09T08:05:00-06:00',
  },
];

/** Deterministic provider used until an HTTP or persistent provider is added. */
export class InMemoryIncidentRepository implements IncidentRepository {
  public constructor(private readonly incidents: readonly Incident[] = fakeIncidents) {}

  public async list(): Promise<readonly Incident[]> {
    return this.incidents;
  }

  public async findById(incidentId: string): Promise<Incident | null> {
    return this.incidents.find((incident) => incident.id === incidentId) ?? null;
  }
}
