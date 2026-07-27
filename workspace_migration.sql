-- 1. Create Workspaces Table
CREATE TABLE workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Insert Default Workspaces
INSERT INTO workspaces (name) VALUES ('IPNET'), ('ACIPL');

-- Get the ID of IPNET for default assignment
DO $$
DECLARE
    ipnet_id UUID;
BEGIN
    SELECT id INTO ipnet_id FROM workspaces WHERE name = 'IPNET';

    -- 2. Add workspace_id to relevant tables and default to IPNET for existing rows

    -- users
    ALTER TABLE users ADD COLUMN workspace_id UUID REFERENCES workspaces(id);
    UPDATE users SET workspace_id = ipnet_id;

    -- tenders and related
    ALTER TABLE tenders ADD COLUMN workspace_id UUID REFERENCES workspaces(id);
    UPDATE tenders SET workspace_id = ipnet_id;
    
    ALTER TABLE tender_documents ADD COLUMN workspace_id UUID REFERENCES workspaces(id);
    UPDATE tender_documents SET workspace_id = ipnet_id;
    
    ALTER TABLE technical_reports ADD COLUMN workspace_id UUID REFERENCES workspaces(id);
    UPDATE technical_reports SET workspace_id = ipnet_id;
    
    ALTER TABLE phase3_records ADD COLUMN workspace_id UUID REFERENCES workspaces(id);
    UPDATE phase3_records SET workspace_id = ipnet_id;
    
    ALTER TABLE phase4_records ADD COLUMN workspace_id UUID REFERENCES workspaces(id);
    UPDATE phase4_records SET workspace_id = ipnet_id;
    
    ALTER TABLE invoices ADD COLUMN workspace_id UUID REFERENCES workspaces(id);
    UPDATE invoices SET workspace_id = ipnet_id;
    
    ALTER TABLE payment_cycles ADD COLUMN workspace_id UUID REFERENCES workspaces(id);
    UPDATE payment_cycles SET workspace_id = ipnet_id;

    -- leads and related
    ALTER TABLE leads ADD COLUMN workspace_id UUID REFERENCES workspaces(id);
    UPDATE leads SET workspace_id = ipnet_id;
    
    ALTER TABLE lead_documents ADD COLUMN workspace_id UUID REFERENCES workspaces(id);
    UPDATE lead_documents SET workspace_id = ipnet_id;
    
    ALTER TABLE lead_technical_reports ADD COLUMN workspace_id UUID REFERENCES workspaces(id);
    UPDATE lead_technical_reports SET workspace_id = ipnet_id;
    
    ALTER TABLE lead_phase3_records ADD COLUMN workspace_id UUID REFERENCES workspaces(id);
    UPDATE lead_phase3_records SET workspace_id = ipnet_id;
    
    ALTER TABLE lead_phase4_records ADD COLUMN workspace_id UUID REFERENCES workspaces(id);
    UPDATE lead_phase4_records SET workspace_id = ipnet_id;
    
    ALTER TABLE lead_invoices ADD COLUMN workspace_id UUID REFERENCES workspaces(id);
    UPDATE lead_invoices SET workspace_id = ipnet_id;
    
    ALTER TABLE lead_payment_cycles ADD COLUMN workspace_id UUID REFERENCES workspaces(id);
    UPDATE lead_payment_cycles SET workspace_id = ipnet_id;

    -- circuits
    ALTER TABLE circuits ADD COLUMN workspace_id UUID REFERENCES workspaces(id);
    UPDATE circuits SET workspace_id = ipnet_id;

    -- notifications
    ALTER TABLE notifications ADD COLUMN workspace_id UUID REFERENCES workspaces(id);
    UPDATE notifications SET workspace_id = ipnet_id;

    -- audit_logs
    ALTER TABLE audit_logs ADD COLUMN workspace_id UUID REFERENCES workspaces(id);
    UPDATE audit_logs SET workspace_id = ipnet_id;

END $$;
