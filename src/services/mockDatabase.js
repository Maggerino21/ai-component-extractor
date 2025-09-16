// src/services/mockDatabase.js
const mockFacilities = [
  { UID: 1, Navn: "Facility Alpha", Lokasjon_UID: 1 },
  { UID: 2, Navn: "Facility Beta", Lokasjon_UID: 2 }
];

const mockPositions = [
  { UID: 101, Anlegg_UID: 1, Posisjon: 101, Beskrivelse: "Mooring Line 1", Referanse: "" },
  { UID: 102, Anlegg_UID: 1, Posisjon: 102, Beskrivelse: "Mooring Line 2", Referanse: "" },
  { UID: 301, Anlegg_UID: 1, Posisjon: 301, Beskrivelse: "Buoy 1", Referanse: "" }
];