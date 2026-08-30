export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_events: {
        Row: {
          created_at: string
          details: string | null
          entry_count: number
          event_type: string
          id: number
          ip_address: string | null
          route: string
          user_agent: string | null
          user_email: string | null
          user_name: string | null
        }
        Insert: {
          created_at?: string
          details?: string | null
          entry_count?: number
          event_type: string
          id?: number
          ip_address?: string | null
          route: string
          user_agent?: string | null
          user_email?: string | null
          user_name?: string | null
        }
        Update: {
          created_at?: string
          details?: string | null
          entry_count?: number
          event_type?: string
          id?: number
          ip_address?: string | null
          route?: string
          user_agent?: string | null
          user_email?: string | null
          user_name?: string | null
        }
        Relationships: []
      }
      buyer_budgets: {
        Row: {
          buyer: string
          created_at: string
          id: number
          monthly_cents: number
          period: string
          updated_at: string
        }
        Insert: {
          buyer: string
          created_at?: string
          id?: never
          monthly_cents?: number
          period: string
          updated_at?: string
        }
        Update: {
          buyer?: string
          created_at?: string
          id?: never
          monthly_cents?: number
          period?: string
          updated_at?: string
        }
        Relationships: []
      }
      buyer_ips: {
        Row: {
          buyer: string
          created_at: string
          id: number
          ip_address: string
          updated_at: string
        }
        Insert: {
          buyer: string
          created_at?: string
          id?: never
          ip_address: string
          updated_at?: string
        }
        Update: {
          buyer?: string
          created_at?: string
          id?: never
          ip_address?: string
          updated_at?: string
        }
        Relationships: []
      }
      buyer_payments: {
        Row: {
          amount_cents: number
          buyer: string
          created_at: string
          due_date: string
          id: number
          import_batch: string | null
        }
        Insert: {
          amount_cents: number
          buyer: string
          created_at?: string
          due_date: string
          id?: never
          import_batch?: string | null
        }
        Update: {
          amount_cents?: number
          buyer?: string
          created_at?: string
          due_date?: string
          id?: never
          import_batch?: string | null
        }
        Relationships: []
      }
      cash_flow_entries: {
        Row: {
          audit_event_id: number | null
          created_at: string
          date: string
          debit_cents: number
          id: number
          source: string
        }
        Insert: {
          audit_event_id?: number | null
          created_at?: string
          date: string
          debit_cents: number
          id?: number
          source: string
        }
        Update: {
          audit_event_id?: number | null
          created_at?: string
          date?: string
          debit_cents?: number
          id?: number
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_flow_entries_audit_event_fk"
            columns: ["audit_event_id"]
            isOneToOne: false
            referencedRelation: "audit_events"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_flow_import_entries: {
        Row: {
          date: string
          debit_cents: number
          id: number
          import_run_id: number
        }
        Insert: {
          date: string
          debit_cents: number
          id?: number
          import_run_id: number
        }
        Update: {
          date?: string
          debit_cents?: number
          id?: number
          import_run_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "cash_flow_import_entries_import_run_id_fkey"
            columns: ["import_run_id"]
            isOneToOne: false
            referencedRelation: "cash_flow_import_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_flow_import_runs: {
        Row: {
          audit_event_id: number | null
          created_at: string
          entry_count: number
          file_name: string | null
          id: number
          mapped_columns: string
          period_end: string
          period_start: string
          total_debit_cents: number
        }
        Insert: {
          audit_event_id?: number | null
          created_at?: string
          entry_count: number
          file_name?: string | null
          id?: number
          mapped_columns: string
          period_end: string
          period_start: string
          total_debit_cents: number
        }
        Update: {
          audit_event_id?: number | null
          created_at?: string
          entry_count?: number
          file_name?: string | null
          id?: number
          mapped_columns?: string
          period_end?: string
          period_start?: string
          total_debit_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "cash_flow_import_runs_audit_event_id_fkey"
            columns: ["audit_event_id"]
            isOneToOne: false
            referencedRelation: "audit_events"
            referencedColumns: ["id"]
          },
        ]
      }
      known_ip_users: {
        Row: {
          created_at: string
          id: number
          ip_address: string
          updated_at: string
          user_name: string
        }
        Insert: {
          created_at?: string
          id?: never
          ip_address: string
          updated_at?: string
          user_name: string
        }
        Update: {
          created_at?: string
          id?: never
          ip_address?: string
          updated_at?: string
          user_name?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
