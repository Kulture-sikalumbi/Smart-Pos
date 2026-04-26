CREATE TABLE public.front_stock (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    brand_id uuid NULL, -- Inherit for RLS and multi-tenant scoping
    item_id uuid NOT NULL,
    location_tag text NOT NULL, -- e.g., 'KITCHEN', 'BAR', 'POS'
    quantity numeric(15, 6) DEFAULT 0.00,
    updated_at timestamp with time zone DEFAULT now(),
    
    CONSTRAINT front_stock_pkey PRIMARY KEY (id),
    CONSTRAINT front_stock_item_id_fkey FOREIGN KEY (item_id) REFERENCES stock_items (id) ON DELETE CASCADE,
    CONSTRAINT unique_item_location UNIQUE(item_id, location_tag)
) TABLESPACE pg_default;

-- Create an index for fast lookups during POS sales and Batching
CREATE INDEX idx_front_stock_brand_location ON public.front_stock (brand_id, location_tag);