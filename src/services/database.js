class DatabaseService {
  async getFacilities() {
    // Switching to real MSSQL when ready
    return this.useMockData ? mockFacilities : await this.queryMSSQL('SELECT * FROM Anlegg');
  }
}