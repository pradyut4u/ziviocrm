-- Create workspace_users table
CREATE TABLE IF NOT EXISTS public.workspace_users (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    workspace_id VARCHAR NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(workspace_id, user_id)
);

-- Enable RLS
ALTER TABLE public.workspace_users ENABLE ROW LEVEL SECURITY;

-- Policies for workspace_users
CREATE POLICY "Enable read access for authenticated users" 
ON public.workspace_users FOR SELECT 
TO authenticated 
USING (true);

CREATE POLICY "Enable all access for admin users" 
ON public.workspace_users FOR ALL 
TO authenticated 
USING (
  EXISTS (
    SELECT 1 FROM public.users 
    WHERE users.id = auth.uid() 
    AND users.role = 'admin'
  )
);

-- Insert initial mappings for existing users to have access to IPNET and ACIPL
-- Assuming all existing users should have access to these two for now
INSERT INTO public.workspace_users (workspace_id, user_id)
SELECT 'IPNET', id FROM public.users
ON CONFLICT (workspace_id, user_id) DO NOTHING;

INSERT INTO public.workspace_users (workspace_id, user_id)
SELECT 'ACIPL', id FROM public.users
ON CONFLICT (workspace_id, user_id) DO NOTHING;
