export class SystemKnowledgeBase {
    constructor() {
        this.internalTables = new Set([
            'daChatMessages',
            'daChatThread',
            'daDashboard'
        ]);

        this.topicTableMap = {
            'ATTENDANCE': ['rhAttendances', 'rhStaff', 'rhClockV'],
            'STAFF': ['rhStaff', 'rhJobpositions'],
            'PROJECTS': ['drProjects', 'rhStaff'],
            'SSOMA': ['soFindings', 'soAccidents', 'rhStaff'],
            'GENERAL': ['rhStaff'] 
        };
        
        this.publicSchemaMetadata = {
            'drCompanies': { hasDatabaseId: true, primaryKey: 'CompanyID' },
            'drContacts': { hasDatabaseId: true, primaryKey: 'ContactID' },
            'drCostcenters': { hasDatabaseId: true, primaryKey: 'CostcenterID' },
            'drFiles': { hasDatabaseId: false, primaryKey: null },
            'drFlows': { hasDatabaseId: true, primaryKey: 'FlowID' },
            'drFlowsLns': { hasDatabaseId: true, primaryKey: 'FlowLnsID' },
            'drPermissions': { hasDatabaseId: true, primaryKey: null },
            'drPermissionsLns': { hasDatabaseId: true, primaryKey: 'PermissionlineID' },
            'drProjects': { hasDatabaseId: true, primaryKey: null },
            'drProjectsNotices': { hasDatabaseId: true, primaryKey: 'NoticeID' },
            'gsAssets': { hasDatabaseId: true, primaryKey: 'AssetID' },
            'gsAssetsAsg': { hasDatabaseId: true, primaryKey: 'AssetsAsgID' },
            'gsAssetsLns': { hasDatabaseId: true, primaryKey: 'AssetLnID' },
            'rhActions': { hasDatabaseId: true, primaryKey: 'ActionID' },
            'rhAdjustments': { hasDatabaseId: true, primaryKey: 'AdjustmentID' },
            'rhAttendances': { hasDatabaseId: true, primaryKey: 'AttendanceID' },
            'rhClockV': { hasDatabaseId: true, primaryKey: 'ClockID' },
            'rhContracts': { hasDatabaseId: false, primaryKey: 'ctID' },
            'rhJobpositions': { hasDatabaseId: true, primaryKey: 'JobpositionID' },
            'rhParameters': { hasDatabaseId: true, primaryKey: 'ParameterID' },
            'rhParametersRF': { hasDatabaseId: true, primaryKey: 'ParameterRF' },
            'rhParametersSS': { hasDatabaseId: true, primaryKey: 'ParameterCCSS' },
            'rhPayrolls': { hasDatabaseId: true, primaryKey: 'PayrollID' },
            'rhPayrollsA': { hasDatabaseId: true, primaryKey: 'PayrollID' },
            'rhPayrollsBns': { hasDatabaseId: true, primaryKey: 'BonusID' },
            'rhPayrollsHistory': { hasDatabaseId: true, primaryKey: 'PayrollHisID' },
            'rhPayrollsHry': { hasDatabaseId: true, primaryKey: 'PayrollHisID' },
            'rhPayrollsV': { hasDatabaseId: true, primaryKey: 'PayrollID' },
            'rhReceipt': { hasDatabaseId: true, primaryKey: 'ReceiptID' },
            'rhReceipts': { hasDatabaseId: true, primaryKey: 'ReceiptID' },
            'rhReports': { hasDatabaseId: true, primaryKey: 'ReportID' },
            'rhSchedules': { hasDatabaseId: true, primaryKey: 'ScheduleID' },
            'rhSchedulesLns': { hasDatabaseId: false, primaryKey: 'ScheduleLineID' },
            'rhStaff': { hasDatabaseId: true, primaryKey: 'StaffID' },
            'rhStaffAcademic': { hasDatabaseId: true, primaryKey: 'AcademicID' },
            'rhStaffContacts': { hasDatabaseId: true, primaryKey: 'ContactID' },
            'rhStaffFiles': { hasDatabaseId: true, primaryKey: 'StaffFilesID' },
            'rhStaffRequests': { hasDatabaseId: true, primaryKey: 'RequestID' },
            'soAccidents': { hasDatabaseId: true, primaryKey: 'AccidentID' },
            'soClassifications': { hasDatabaseId: true, primaryKey: 'ClassificationID' },
            'soFindings': { hasDatabaseId: true, primaryKey: 'FindingID' },
            'soSanctions': { hasDatabaseId: true, primaryKey: 'SanctionID' },
            'soTrainings': { hasDatabaseId: true, primaryKey: 'TrainingID' },
            'soTrainingsLns': { hasDatabaseId: true, primaryKey: 'TrainingLineID' }
        };

        this.schemaContext = `daChatMessages (cmID, ctThreadID, cmRole, cmContent, cmCreatedAt)\ndaChatThread (ctID, ctClientPrefix, ctLicenseID, ctThreadID, ctAssistantID, ctCreatedAt)\ndaDashboard (LicenseID, daClientPrefix, daClientName, daLicenseHash, daLicenseSalt, daStatus, daExpiryDate, daExpiryAt, daAllowAll, daFailedStreak, daLastSuccessAt, daLastFailedAt, daRevokedAt, daRevokedReason, daCreatedAt, daUpdatedAt, lcLastUsedAt, daLicenseHash_old, daAccessSig, daFailCount, daLastFailAt, daLockUntil)\ndrCompanies (CompanyID, isDeleted, DatabaseID, cpCategory, cpTitle, cpName, cpDescription, cpIdentification, cpLegalrepresentative, cpRepresentativeID, cpRepresentativeSignature, cpCountry, cpAddress, cpWebpage, cpEmail, cpPhone, cpServices, cpCredit, cpObservations, cpStatus, cpImage, cpCreatedBy, cpCreatedAt, cpModifiedby, cpModifiedAt, cpBot)\ndrContacts (ContactID, isDeleted, DatabaseID, cnName, CompanyID, cnJobposition, cnEmail, cnPhone, cnImage, cnObservations, cnCreatedBy, cnCreatedAt, cnModifiedBy, cnModifiedAt)\ndrCostcenters (CostcenterID, isDeleted, DatabaseID, ccTitle, ccCode, ccDescription, ccProjects, ccCompanies, ccStatus, ccCreatedby, ccCreateddate, ccModifiedby, ccModifieddate)\ndrFiles (DriveID, dfFolderID, dfName, dfMimeType, dfSize, dfPath, dfUpdatedAt, dfStatus)\ndrFlows (FlowID, isDeleted, DatabaseID, fwTitle, fwDescription, fwProjects, fwCompanies, fwType, fwAdmin, fwObservations, fwStatus, fwCreatedby, fwCreateddate, fwModifiedby, fwModifieddate)\ndrFlowsLns (FlowLnsID, isDeleted, DatabaseID, FlowID, wlUsers, wlStep, wlDescription, fwCreatedby, fwCreateddate, fwModifiedby, fwModifieddate)\ndrPermissions (PermissionID, isDeleted, DatabaseID, prTitile, prDescription, prStatus, prCreatedby, prCreateddate, prModifiedby, prModifieddate)\ndrPermissionsLns (PermissionlineID, isDeleted, DatabaseID, PermissionID, AppID, plPermission, plPII, prStatus, prCreatedby, prCreateddate, prModifiedby, prModifieddate)\ndrProjects (ProjectID, isDeleted, DatabaseID, pjTitle, pjCode, pjDescription, pjType, pjArea, pjClient, pjConfidential, pjCountry, pjProvince, pjCanton, pjDistrict, pjAddress, pjUbication, pjVirtualfence, pjImage, ScheduleID, pjDatestart, pjDateend, pjControl, pjApproveextras, pjStatus, pjCreatedBy, pjCreatedAt, pjModifiedBy, pjModifiedAt, pjBot)\ndrProjectsNotices (NoticeID, isDeleted, DatabaseID, ProjectID, pnEvent, pnType, UserID, pnTime, pnStatus, pnCreatedby, pnCreateddate, pnModifiedby, pnModifieddate)\ngsAssets (AssetID, isDeleted, DatabaseID, asTitle, asDescription, asCategory, asType, asBrand, asModel, asYear, asDimensions, asWeight, asCapacity, asFeatures, asImage, asObservations, asStatus, asCreatedBy, asCreatedAt, asModifiedBy, asModifiedAt, Bot)\ngsAssetsAsg (AssetsAsgID, DatabaseID, agDate, agConsecutive, UserID, AssetLnID, StaffID, agReceivedSignature, agObservations, agFile, DriveID, Bot)\ngsAssetsLns (AssetLnID, DatabaseID, AssetID, alConsecutive, asPlate, asSerial, asColor, alDocument, SupplierID, CurrencyID, alPurchase, al Warranty, alValue, alObservations, alStatus, alCreatedBy, alCreatedAt, alModifiedBy, alModifiedAt)\nrhActions (ActionID, isDeleted, DatabaseID, acDate, StaffID, acType, CompanyID, ProjectID, FlowID, PayrollID, CostcenterID, JobpositionID, acSalary, acDayslist, acPayable, acGross, acInsurance, acNet, acFile, acObservations, acStatus, acCreatedBy, acCreatedAt, acModifiedBy, acModifiedAt, DriveID, acBot)\nrhAdjustments (AdjustmentID, isDeleted, DatabaseID, adDate, StaffID, CompanyID, JobpositionID, adSalary, ProjectID, PayrollID, CostcenterID, adTitle, adApply, adType, adCalcule, adDaytype, adShift, adOrdinary, adExtras, adDoubles, adTriples, adPayable, CurrencyID, adXE, adGross, adInsurance, adNet, adFile, adObservations, adStatus, adCreatedBy, adCreatedAt, adModifiedBy, adModifiedAt)\nrhAttendances (AttendanceID, isDeleted, DatabaseID, atDate, StaffID, JobpositionID, atSalary, ProjectID, ScheduleLineID, PayrollID, CostcenterID, atWeek, atComment, atApprovedby, atApproveddate, atDaytype, atShift, atClockin, atEntrance, atClockout, atDeparture, atHours, atCumulative, atMissing, atOrdinary, atExtras, atDoubles, atTriples, atPayable, atGross, atInsurance, atNet, atStatus, atCreatedBy, atCreatedAt, atModifiedBy, atModifiedAt)\nrhClockV (ClockID, isDeleted, DatabaseID, ProjectID, StaffID, AttendanceID, ckTimestamp, ckType, ckQR, ckImage, ckLocation, DriveID, ckBiometrics, ckCreatedby, ckDevice, ckHost, ckDistance, CompanyID, ScheduleLineID)\nrhContracts (ctID, emName, emLegalID, emRepName, emRepID, emRepRole, coName, coID, coEmail, coSex, coAge, coNationality, coCivilStatus, coAddressProvince, coAddressCanton, coAddressDistrict, pjTitle, pjProvince, pjCanton, pjDistrict, coPosition, ctType, ctIssueDate, ctStartDate, ctEndDate, ctSignCity, ctSignDate, ctSignHour, payMonthlyAmount, payHourlyAmount, payFrequency, uniformCost, workdayType, repSignatureFile, workerSignatureFile)\nrhJobpositions (JobpositionID, isDeleted, DatabaseID, jpTitle, jpType, jpDepartment, jpCategory, CompanyID, jpDescription, jpCCSS, jpINS, CurrencyID, jpMonthly, jpSalary, jpExtras, jpDoubles, jpTriples, jpStatus, jpCreatedby, jpCreateddate, jpModifiedby, jpModifieddate)\nrhParameters (ParameterID, isDeleted, DatabaseID, ptCategory, ptTitle, ptDescription, ptSince, ptUntil, ptCreditspouse, ptCreditchildren, ptFiles, ptCreatedby, ptCreateddate, ptModifiedby, ptModifieddate)\nrhParametersRF (ParameterRF, DatabaseID, isDeleted, ParameterID, ptFrom, ptTo, ptPercentage, ptCreatedby, ptCreateddate, ptModifiedby, ptModifieddate)\nrhParametersSS (ParameterCCSS, isDeleted, DatabaseID, ParameterID, ptCategory, ptTitle, ptDescription, ptRetired, ptPatron, ptStaff, ptCreatedby, ptCreateddate, ptModifiedby, ptModifieddate)\nrhPayrolls (PayrollID, isDeleted, DatabaseID, UserID, CompanyID, pyProjects, pyType, pySince, pyUntil, pyAdvancedate, pyPayday, pyXE, pyStaff, pyAttendances, pyActions, pyAdjustments, pyOrdinary, pyExtras, pyDoubles, pyTriples, pyHours, pyPayables, pyStatus, pyCreatedby, pyCreateddate, pyModifiedby, pyModifieddate, pyBot)\nrhPayrollsA (PayrollID, DatabaseID, pyConsecutive, pyMode, pyType, CompanyID, pyProjects, pySince, pyUntil, pyAdvanced, pyPayday, pyXE, pyStaff, pyAttendances, pyAdjustments, pyActions, pyReceipts, pyHours, pyOrdinary, pyExtras, pyDoubles, pyTriples, pyPayables, pyGross, pyInsurance, pyNet, pyFiles, pyStatus, pyMark, pyVersion, pyCreatedBy, pyCreatedAt, pyModifiedBy, pyModifiedAt, pyReviewedBy, pyReviewedAt, pyApprovedBy, pyApprovedAt, FolderID, Bot)\nrhPayrollsBns (BonusID, DatabaseID, PayrollID, StaffID, pbLines, pbMonths, pbAccumulated, pbAmount, pbNotes, pbSignature, pbFile, pbStatus, pbVersion, pbCreatedBy, pbCreatedAt, pbModifiedBy, pbModifiedAt, pbMark, Bot)\nrhPayrollsHistory (PayrollHisID, isDeleted, DatabaseID, phDate, StaffID, phPayrolls, phAttendances, phActions, phAdjustments, phAdjustmentsGross, phGross, phInsurance, phEmbargo, phCreditinfavor, phIncometax, phAdjustmentsNet, phNet, Bot)\nrhPayrollsHry (PayrollHisID, DatabaseID, StaffID, phDate, phIdentification, phPayrolls, phAttendances, phActions, phAdjustments, phAdjustmentsGross, phGross, phInsurance, phEmbargo, phCreditinfavor, phIncometax, phAdjustmentsNet, phNet, Bot)\nrhPayrollsV (PayrollID, isDeleted, DatabaseID, UserID, CompanyID, pyProjects, pyType, pySince, pyUntil, pyAdvancedate, pyPayday, pyXE, pyStaff, pyAttendances, pyActions, pyAdjustments, pyOrdinary, pyExtras, pyDoubles, pyTriples, pyHours, pyPayables, pyStatus, pyCreatedby, pyCreateddate, pyModifiedby, pyModifieddate, FolderID, pyBot)\nrhReceipt (ReceiptID, isDeleted, DatabaseID, PayrollID, StaffID, ppAttendances, ppActions, ppAdjustments, ppAdjustmentsGross, ppGross, ppInsurance, ppCreditinfavor, ppIncometax, ppAdjustmentsNet, ppNet, ppSignature, ppFile, DriveID, ppEnvoy, Bot)\nrhReceipts (ReceiptID, DatabaseID, PayrollID, StaffID, JobpositionID, CurrencyID, ppMonthly, ppDaily, ppSalary, ppAttendances, ppAdjustments, ppActions, ppDays, ppHours, ppMissing, ppOrdinary, ppExtras, ppDoubles, ppTriples, ppPayables, ppWorked, ppAbsences, ppHolidays, ppIncapacities, ppVacations, ppLicenses, ppNoticeday, ppPermissions, ppSuspension, ppSanctions, ppBonuses, ppCommissions, ppIncentives, ppPerdiem, ppTransportation, ppLoans, ppEmbargo, ppUniform, ppZoning, ppAdjustmentsGross, ppAdjustmentsNet, ppAccumulated, ppIncometax, ppCreditinfavor, ppGross, ppInsurance, ppNet, ppSignature, ppFile, ppVersion, ppMedia, ppCreatedBy, ppCreatedAt, ppModifiedBy, ppModifiedAt, ppSubmittedBy, ppSubmittedAt, ppStatus, ppMark, DriveID, Bot)\nrhReports (ReportID, DatabaseID, rpTimestamp, rpTo, rpType, rpMedia, rpFormat, rpSince, rpUntil, rpProjects, rpCompanies, rpPayrolls, rpStaff, rpAttendances, rpAdjustments, rpActions, rpClock, rpFile, DriveID)\nrhSchedules (ScheduleID, isDeleted, DatabaseID, shTitle, shCumulative, shPenaltyformissing, shMode, shStart, shEnd, shCreatedby, shCreateddate, shModifiedby, shModifieddate)\nrhSchedulesLns (ScheduleLineID, IsDeleted, ScheduleID, shOrder, shDay, shType, shShift, shOrdinaryTime, shEntrytime, shEntrytimefrom, shEntrytimeuntil, shEntryTolerance, shDeparturetime, shDeparturetimefrom, shDeparturetimeuntil, shDepartureTolerance, shLabel, shCreatedby, shCreateddate, shModifiedby, shModifieddate)\nrhStaff (StaffID, isDeleted, DatabaseID, stType, stName, stFirstsurname, stSecondsurname, stAlias, stNationality, stDocument, stEmission, stExpiration, stIdentification, stCarnet, stBirthdate, stPlaceofbirth, stSex, stBloodtype, stCivilstatus, stDependentspouse, stDependentchildren, stEmail, stMobile, stPhone, stExtension, stCountry, stProvince, stCanton, stDistrict, stAddress, stEmergencycontact, stImage, stCode, CompanyID, JobpositionID, stAllprojects, stProjects, CostcenterID, ScheduleID, stChief, stRetired, stIncome, stDeparture, stReasondeparture, stRecommended, stFeedback, stBank, stBankaccount, stLanguages, stSkills, stHobbies, stObservations, stLicense, stAccess, stRegister, stMode, stStatus, stCreatedBy, stCreatedAt, stModifiedBy, stModifiedAt, FolderID, DriveID, FaceEmbedding, Bot)\nrhStaffAcademic (AcademicID, isDeleted, DatabaseID, StaffID, saTitle, saDescription, saLevel, saInstitution, saCountry, saStart, saEnd, saFile, DriveID, saCreatedBy, saCreatedAt, saModifiedBy, saModifiedAt)\nrhStaffContacts (ContactID, isDeleted, DatabaseID, StaffID, scName, scRelationship, scPhone, scEmail, scCreatedby, scCreateddate, scModifiedby, scModifieddate)\nrhStaffFiles (StaffFilesID, isDeleted, DatabaseID, StaffID, sfGenere, sfFile, sfTitle, ProjectID, sfSalary, sfLetters, sjLevies, sfEmission, sfValidity, sfSignature, DriveID, sfMimeType, sfFileSize, sfFileDate, sfOCR, sfTags, sfCreatedby, sfCreateddate, sfModifiedby, sfModifieddate, sfThumbnail, sfBot)\nrhStaffRequests (RequestID, isDeleted, DatabaseID, srDate, StaffID, srType, srReason, srDaylist, srChief, srFile, srObservations, srStatus, srCreatedBy, srCreatedAt, srModifiedBy, srModifiedAt, ActionID, srBot)\nsoAccidents (AccidentID, isDeleted, DatabaseID, anDate, ProjectID, anLocation, CompanyID, UserID, anActivity, anType, anImage, anObservations, snCreatedby, snCreationdate, snModifiedby, snModifieddate, snBot)\nsoClassifications (ClassificationID, isDeleted, DatabaseID, cfTitle, cfCode, cfCategory, cfDescription, cfImage, cfCreatedby, cfCreationdate, cfModifiedby, cfModifieddate)\nsoFindings (FindingID, isDeleted, DatabaseID, fdImage, fdTimestamp, ProjectID, CompanyID, StaffID, fdUbication, fdActivity, fdActiontaken, fdObservations, fdDescription, fdLevel, fdUnsafeacts, fdUnsafeconditions, fdRecommendation, fdStatus, fdCreatedby, fdCreationdate, fdModifiedby, fdModifieddate, DriveID, fdBot)\nsoSanctions (SanctionID, isDeleted, DatabaseID, FindingID, snDate, ProjectID, snLocation, CompanyID, UserID, snActivity, snUnsafeacts, snUnsafeconditions, snType, snLevel, StaffID, CurrencyID, snValue, snSignature, snObservations, snCreatedby, snCreationdate, snModifiedby, snModifieddate, snBot)\nsoTrainings (TrainingID, isDeleted, DatabaseID, trDate, trTitle, ProjectID, trDuration, trCoach, trSignature, trObservations, trCreatedby, trCreationdate, trModifiedby, trModifieddate, DriveID, trBot)\nsoTrainingsLns (TrainingLineID, isDeleted, DatabaseID, TrainingID, CompanyID, StaffID, trName, trIdentification, trSignature)`;
    }

    getSchemaSummary() {
        return this.schemaContext;
    }

    getSchemaForTopic(topic) {
        const tableNames = this.topicTableMap[topic] || this.topicTableMap['GENERAL'];
        
        let relevantContext = "INSTRUCCIONES TÉCNICAS SQL (USO INTERNO):\n- Filtro OBLIGATORIO: 'WHERE DatabaseID = ...' en todas las tablas.\n- Relación: 'StaffID' conecta tablas.\n- REGLA GLOBAL: stStatus = 1 para activos.\n\nTABLAS REQUERIDAS:\n";
        
        const tableContextLines = this.schemaContext.split('\n');
        for (const tableName of tableNames) {
            const line = tableContextLines.find(line => line.trim().startsWith(tableName + ' '));
            if (line) relevantContext += line.trim() + '\n';
        }
        return relevantContext.trim();
    }
        

    isTableAccessible(tableName) {
        if (this.internalTables.has(tableName) || tableName.startsWith('da')) return false;
        return true;
    }

    tableHasIsolation(tableName) {
        return this.publicSchemaMetadata[tableName]?.hasDatabaseId || false;
    }
}

export class QueryBuilder {
    constructor(knowledgeBase) { this.kb = knowledgeBase; }

    validateSecurity(sql, clientDatabaseId) {
        const upperSql = sql.toUpperCase();
        const forbidden = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'TRUNCATE', 'GRANT', 'REVOKE'];
        if (forbidden.some(word => upperSql.includes(word))) throw new Error("Security Alert: Solo SELECT permitido.");
        if (!upperSql.includes(clientDatabaseId.toUpperCase())) console.warn(`⚠️ Advertencia: SQL sin filtro explícito DatabaseID.`);
        return sql;
    }
}

export class TranslationLayer {
    constructor() { this.columnDictionary = {}; }
    loadDictionary(data) { this.columnDictionary = { ...this.columnDictionary, ...data }; }
}

export const kb = new SystemKnowledgeBase();
export const sqlEngine = new QueryBuilder(kb);
export const translator = new TranslationLayer();