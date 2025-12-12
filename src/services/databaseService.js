const sql = require('mssql');
require('dotenv').config();
const logger = require('../utils/logger');

class DatabaseService {
    constructor() {
        this.config = {
            server: process.env.DB_SERVER,
            database: process.env.DB_NAME,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            port: parseInt(process.env.DB_PORT || '1433'),
            options: {
                encrypt: process.env.DB_ENCRYPT === 'true',
                trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
                enableArithAbort: true
            },
            pool: {
                max: 10,
                min: 0,
                idleTimeoutMillis: 30000
            }
        };
        this.pool = null;
        this.isConnected = false;
    }

    async connect() {
        if (this.isConnected && this.pool) {
            return true;
        }

        try {
            logger.info('Connecting to database...', {
                server: this.config.server,
                database: this.config.database
            });

            this.pool = await sql.connect(this.config);
            this.isConnected = true;

            logger.info('✅ Successfully connected to database');
            return true;
        } catch (error) {
            logger.error('❌ Database connection failed', error);
            this.isConnected = false;
            throw error;
        }
    }

    async disconnect() {
        if (this.pool) {
            await this.pool.close();
            this.isConnected = false;
            logger.info('Database connection closed');
        }
    }

    async testConnection() {
        try {
            await this.connect();
            const result = await this.pool.request().query('SELECT 1 as test');
            return { success: true, connected: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async getLocalities() {
        await this.connect();
        
        try {
            const result = await this.pool.request().query`
                SELECT 
                    Id,
                    LocationNr,
                    Name,
                    Latitude,
                    Longitude,
                    Active,
                    CustomerId
                FROM Locality
                WHERE IsDeleted = 0 AND Active = 1
                ORDER BY Name
            `;

            logger.info(`Loaded ${result.recordset.length} localities`);
            return result.recordset;
        } catch (error) {
            logger.error('Failed to load localities', error);
            throw error;
        }
    }

    async getMooring(localityId) {
        await this.connect();

        try {
            const result = await this.pool.request()
                .input('localityId', sql.Int, localityId)
                .query`
                    SELECT 
                        Id,
                        Name,
                        Description,
                        Type,
                        Active,
                        LocalityId,
                        NoOfMooringLines,
                        NoOfCages
                    FROM Mooring
                    WHERE LocalityId = @localityId 
                      AND IsDeleted = 0 
                      AND Active = 1
                `;

            if (result.recordset.length === 0) {
                logger.warn(`No active mooring found for locality ${localityId}`);
                return null;
            }

            logger.info(`Loaded mooring: ${result.recordset[0].Name}`);
            return result.recordset[0];
        } catch (error) {
            logger.error('Failed to load mooring', error);
            throw error;
        }
    }

    async getPositions(mooringId) {
        await this.connect();

        try {
            const result = await this.pool.request()
                .input('mooringId', sql.Int, mooringId)
                .query`
                    SELECT 
                        Id,
                        Name,
                        Reference,
                        Type,
                        Latitude,
                        Longitude,
                        Depth,
                        Mbl,
                        Note,
                        InstallationDate,
                        IsActive,
                        MooringId
                    FROM Position
                    WHERE MooringId = @mooringId 
                      AND IsDeleted = 0
                    ORDER BY Name
                `;

            logger.info(`Loaded ${result.recordset.length} positions for mooring ${mooringId}`);
            return result.recordset;
        } catch (error) {
            logger.error('Failed to load positions', error);
            throw error;
        }
    }

    async getProductCatalog(supplierId = null) {
        await this.connect();

        try {
            let query;
            const request = this.pool.request();

            if (supplierId) {
                query = `
                    SELECT 
                        p.Id,
                        p.Number as InternalNumber,
                        p.Description,
                        p.MinimumBreakingLoad,
                        p.Active,
                        s.Id as SupplierId,
                        s.Name as SupplierName,
                        u.Name as UnitName,
                        u.Abbreviation as UnitAbbr,
                        pc.Name as CategoryName
                    FROM Product p
                    INNER JOIN Supplier s ON p.SupplierId = s.Id
                    LEFT JOIN Unit u ON p.UnitId = u.Id
                    LEFT JOIN ProductCategory pc ON p.ProductCategoryId = pc.Id
                    WHERE p.IsDeleted = 0 
                      AND p.Active = 1
                      AND s.IsDeleted = 0
                      AND p.SupplierId = @supplierId
                    ORDER BY s.Name, p.Description
                `;
                request.input('supplierId', sql.Int, supplierId);
            } else {
                query = `
                    SELECT 
                        p.Id,
                        p.Number as InternalNumber,
                        p.Description,
                        p.MinimumBreakingLoad,
                        p.Active,
                        s.Id as SupplierId,
                        s.Name as SupplierName,
                        u.Name as UnitName,
                        u.Abbreviation as UnitAbbr,
                        pc.Name as CategoryName
                    FROM Product p
                    INNER JOIN Supplier s ON p.SupplierId = s.Id
                    LEFT JOIN Unit u ON p.UnitId = u.Id
                    LEFT JOIN ProductCategory pc ON p.ProductCategoryId = pc.Id
                    WHERE p.IsDeleted = 0 
                      AND p.Active = 1
                      AND s.IsDeleted = 0
                    ORDER BY s.Name, p.Description
                `;
            }

            const result = await request.query(query);
            
            const catalog = result.recordset.map(p => ({
                id: p.Id,
                internalNumber: p.InternalNumber,
                description: p.Description,
                supplier: p.SupplierName,
                supplierId: p.SupplierId,
                mbl: p.MinimumBreakingLoad,
                unit: p.UnitAbbr || p.UnitName,
                category: p.CategoryName
            }));

            logger.info(`Loaded ${catalog.length} products from catalog` + 
                (supplierId ? ` for supplier ${supplierId}` : ''));
            
            return catalog;
        } catch (error) {
            logger.error('Failed to load product catalog', error);
            throw error;
        }
    }

    async getSuppliers() {
        await this.connect();

        try {
            const result = await this.pool.request().query`
                SELECT 
                    Id,
                    Name,
                    OrganizationNumber,
                    ContactPerson,
                    IsActive
                FROM Supplier
                WHERE IsDeleted = 0 AND IsActive = 1
                ORDER BY Name
            `;

            logger.info(`Loaded ${result.recordset.length} suppliers`);
            return result.recordset;
        } catch (error) {
            logger.error('Failed to load suppliers', error);
            throw error;
        }
    }

    async findSupplierByName(supplierName) {
        await this.connect();

        try {
            const result = await this.pool.request()
                .input('supplierName', sql.NVarChar, `%${supplierName}%`)
                .query`
                    SELECT Id, Name
                    FROM Supplier
                    WHERE Name LIKE @supplierName
                      AND IsDeleted = 0
                      AND IsActive = 1
                `;

            if (result.recordset.length > 0) {
                return result.recordset[0];
            }
            return null;
        } catch (error) {
            logger.error('Failed to find supplier', error);
            throw error;
        }
    }

    async createSupplier(supplierName) {
        await this.connect();

        try {
            const result = await this.pool.request()
                .input('name', sql.NVarChar, supplierName)
                .query`
                    INSERT INTO Supplier (Name, IsActive, IsDeleted, CreatedAt, UpdatedAt)
                    OUTPUT INSERTED.Id, INSERTED.Name
                    VALUES (@name, 1, 0, GETDATE(), GETDATE())
                `;

            logger.info(`Created new supplier: ${supplierName} (ID: ${result.recordset[0].Id})`);
            return result.recordset[0];
        } catch (error) {
            logger.error('Failed to create supplier', error);
            throw error;
        }
    }

    async getUnits() {
        await this.connect();

        try {
            const result = await this.pool.request().query`
                SELECT 
                    Id,
                    Name,
                    Abbreviation,
                    Description
                FROM Unit
                WHERE IsDeleted = 0
                ORDER BY Name
            `;

            logger.info(`Loaded ${result.recordset.length} units`);
            return result.recordset;
        } catch (error) {
            logger.error('Failed to load units', error);
            throw error;
        }
    }

    async findUnitByAbbreviation(abbreviation) {
        await this.connect();

        try {
            const result = await this.pool.request()
                .input('abbr', sql.NVarChar, abbreviation)
                .query`
                    SELECT Id, Name, Abbreviation
                    FROM Unit
                    WHERE Abbreviation = @abbr OR Name = @abbr
                      AND IsDeleted = 0
                `;

            if (result.recordset.length > 0) {
                return result.recordset[0];
            }
            return null;
        } catch (error) {
            logger.error('Failed to find unit', error);
            throw error;
        }
    }

    async insertComponent(componentData) {
        await this.connect();

        try {
            const result = await this.pool.request()
                .input('positionId', sql.Int, componentData.positionId)
                .input('productId', sql.Int, componentData.productId)
                .input('productNumber', sql.NVarChar, componentData.productNumber)
                .input('productDescription', sql.NVarChar, componentData.productDescription)
                .input('supplierId', sql.Int, componentData.supplierId)
                .input('quantity', sql.Decimal(18, 2), componentData.quantity)
                .input('unitId', sql.Int, componentData.unitId)
                .input('mbl', sql.Decimal(18, 2), componentData.mbl)
                .input('installationDate', sql.DateTime, componentData.installationDate)
                .input('notes', sql.NVarChar, componentData.notes)
                .query`
                    INSERT INTO Component (
                        PositionId,
                        ProductId,
                        ProductNumber,
                        ProductDescription,
                        SupplierId,
                        Quantity,
                        UnitId,
                        MinimumBreakingLoad,
                        InstallationDate,
                        Notes,
                        IsDeleted,
                        CreatedAt,
                        UpdatedAt
                    )
                    OUTPUT INSERTED.Id
                    VALUES (
                        @positionId,
                        @productId,
                        @productNumber,
                        @productDescription,
                        @supplierId,
                        @quantity,
                        @unitId,
                        @mbl,
                        @installationDate,
                        @notes,
                        0,
                        GETDATE(),
                        GETDATE()
                    )
                `;

            logger.info(`Inserted component (ID: ${result.recordset[0].Id}) for position ${componentData.positionId}`);
            return result.recordset[0].Id;
        } catch (error) {
            logger.error('Failed to insert component', error);
            throw error;
        }
    }

    async updatePositionReference(positionId, reference) {
        await this.connect();

        try {
            await this.pool.request()
                .input('positionId', sql.Int, positionId)
                .input('reference', sql.NVarChar, reference)
                .query`
                    UPDATE Position
                    SET Reference = @reference,
                        UpdatedAt = GETDATE()
                    WHERE Id = @positionId
                `;

            logger.info(`Updated position ${positionId} reference to: ${reference}`);
        } catch (error) {
            logger.error('Failed to update position reference', error);
            throw error;
        }
    }
}

module.exports = DatabaseService;
