// src/services/database.js
class DatabaseService {
  async getFacilities() {
    // Use mock data during development
    // Switch to real MSSQL when ready
    return this.useMockData ? mockFacilities : await this.queryMSSQL('SELECT * FROM Anlegg');
  }
}