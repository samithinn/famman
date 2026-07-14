"use client";

import { useState, useEffect } from "react";
import { Loader2, Pencil, Trash2, Check, X, Plus, Shield, User, MessageSquare, Zap, ChevronDown, Pause, Play, Repeat } from "lucide-react";
import { supabase } from "@/lib/supabase";
import PullToRefresh from "./PullToRefresh";
import ThemeToggle from "./ThemeToggle";

type CatType = "expense" | "income";
type Category = { id: string; name: string; type: CatType };
type Role = "admin" | "user";
type UserEntry = { id: string; email: string; full_name: string; role: Role };
type ResponseType = "income" | "expense";
type LineResponse = { id: string; category: string; response_text: string; type: ResponseType };
type SubPaymentMethod = "Cash" | "Credit Card";
type Subscription = {
  id: string; name: string; amount: number; billing_day: number;
  category: string; payment_method: SubPaymentMethod; active: boolean;
  last_charged_month: string | null;
};

export default function SettingsView() {
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<Role>("user");

  // LINE connection
  const [lineLinked, setLineLinked] = useState(false);
  const [linkLoading, setLinkLoading] = useState(false);
  const [lineWaiting, setLineWaiting] = useState(false);
  const [unlinkLoading, setUnlinkLoading] = useState(false);
  const [lineError, setLineError] = useState("");

  // Budget
  const [budget, setBudget] = useState("");
  const [budgetLoading, setBudgetLoading] = useState(false);
  const [budgetSaved, setBudgetSaved] = useState(false);

  // Categories
  const [categories, setCategories] = useState<Category[]>([]);
  const [catLoading, setCatLoading] = useState(true);
  const [newExpenseCatName, setNewExpenseCatName] = useState("");
  const [newIncomeCatName, setNewIncomeCatName] = useState("");
  const [expenseCatOpen, setExpenseCatOpen] = useState(false);
  const [incomeCatOpen, setIncomeCatOpen] = useState(false);
  const [addingCat, setAddingCat] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editType, setEditType] = useState<CatType>("expense");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [catError, setCatError] = useState("");

  // Admin: user management
  const [users, setUsers] = useState<UserEntry[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [changingRole, setChangingRole] = useState<string | null>(null);
  const [usersError, setUsersError] = useState("");

  // Category rules
  type RuleSourceType = "ocr" | "chat";
  type CategoryRule = { id: string; keyword: string; category: string; source_type: RuleSourceType };
  const [rules, setRules] = useState<CategoryRule[]>([]);
  const [rulesLoading, setRulesLoading] = useState(true);
  const [rulesError, setRulesError] = useState("");
  const [ruleTab, setRuleTab] = useState<RuleSourceType>("ocr");
  const [newRuleKeyword, setNewRuleKeyword] = useState("");
  const [newRuleCategory, setNewRuleCategory] = useState("");
  const [addingRule, setAddingRule] = useState(false);
  const [deletingRuleId, setDeletingRuleId] = useState<string | null>(null);

  // Subscriptions (recurring monthly expenses)
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [subsLoading, setSubsLoading] = useState(true);
  const [subsError, setSubsError] = useState("");
  const [newSubName, setNewSubName] = useState("");
  const [newSubAmount, setNewSubAmount] = useState("");
  const [newSubDay, setNewSubDay] = useState("1");
  const [newSubCategory, setNewSubCategory] = useState("");
  const [newSubPaymentMethod, setNewSubPaymentMethod] = useState<SubPaymentMethod>("Cash");
  const [addingSub, setAddingSub] = useState(false);
  const [editingSubId, setEditingSubId] = useState<string | null>(null);
  const [editSubName, setEditSubName] = useState("");
  const [editSubAmount, setEditSubAmount] = useState("");
  const [editSubDay, setEditSubDay] = useState("1");
  const [editSubCategory, setEditSubCategory] = useState("");
  const [editSubPaymentMethod, setEditSubPaymentMethod] = useState<SubPaymentMethod>("Cash");
  const [deletingSubId, setDeletingSubId] = useState<string | null>(null);
  const [togglingSubId, setTogglingSubId] = useState<string | null>(null);

  // Admin: LINE bot responses
  const [lineResponses, setLineResponses] = useState<LineResponse[]>([]);
  const [lineRespLoading, setLineRespLoading] = useState(false);
  const [lineRespError, setLineRespError] = useState("");
  const [newRespCategory, setNewRespCategory] = useState("");
  const [newRespText, setNewRespText] = useState("");
  const [newRespType, setNewRespType] = useState<ResponseType>("expense");
  const [addingResp, setAddingResp] = useState(false);
  const [editingRespId, setEditingRespId] = useState<string | null>(null);
  const [editRespCategory, setEditRespCategory] = useState("");
  const [editRespText, setEditRespText] = useState("");
  const [editRespType, setEditRespType] = useState<ResponseType>("expense");
  const [deletingRespId, setDeletingRespId] = useState<string | null>(null);
  const [respCategoryFilter, setRespCategoryFilter] = useState("");
  // Empty by default = every group starts collapsed; a category name here means the user opened it.
  const [expandedRespCats, setExpandedRespCats] = useState<Set<string>>(new Set());

  // Admin: bot help message
  const [helpMessage, setHelpMessage] = useState("");
  const [helpMessageLoading, setHelpMessageLoading] = useState(false);
  const [helpMessageSaving, setHelpMessageSaving] = useState(false);
  const [helpMessageSaved, setHelpMessageSaved] = useState(false);
  const [helpMessageError, setHelpMessageError] = useState("");

  // Collapsible sections — default collapsed to save space
  const [userMgmtOpen, setUserMgmtOpen] = useState(false);
  const [personalityOpen, setPersonalityOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [helpMessageOpen, setHelpMessageOpen] = useState(false);
  const [subsOpen, setSubsOpen] = useState(false);

  useEffect(() => {
    fetchProfile();
    fetchCategories();
    fetchLineStatus();
    fetchCategoryRules();
    fetchSubscriptions();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshAll = () => Promise.all([fetchProfile(), fetchCategories(), fetchLineStatus(), fetchCategoryRules(), fetchSubscriptions()]);

  async function fetchProfile() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setCurrentUserId(user.id);
    const { data } = await supabase
      .from("profiles")
      .select("monthly_budget, role")
      .eq("id", user.id)
      .single();
    if (data?.monthly_budget) setBudget(String(data.monthly_budget));
    const role = (data?.role ?? "user") as Role;
    setUserRole(role);
    if (role === "admin") {
      fetchUsers();
      fetchLineResponses();
      fetchHelpMessage();
    }
  }

  async function fetchLineStatus() {
    const res = await fetch("/api/line-link");
    if (!res.ok) return;
    const data = await res.json();
    setLineLinked(data.linked);
    if (data.linked) setLineWaiting(false);
  }

  async function connectLine() {
    setLinkLoading(true);
    setLineError("");
    const res = await fetch("/api/line-link", { method: "POST" });
    const data = await res.json();
    setLinkLoading(false);
    if (!res.ok) { setLineError(data.error ?? "Failed to connect."); return; }

    const token: string = data.token;
    const deepLink = `https://line.me/R/oaMessage/@786vntxk/?link%20${token}`;

    window.open(deepLink, "_blank");

    setLineWaiting(true);
    // Poll every 3 s until linked (max 10 min)
    let attempts = 0;
    const poll = setInterval(async () => {
      attempts++;
      const check = await fetch("/api/line-link");
      if (!check.ok) return;
      const d = await check.json();
      if (d.linked) {
        clearInterval(poll);
        setLineLinked(true);
        setLineWaiting(false);
      } else if (attempts >= 200) {
        clearInterval(poll);
        setLineWaiting(false);
      }
    }, 3000);
  }

  async function unlinkLine() {
    setUnlinkLoading(true);
    setLineError("");
    const res = await fetch("/api/line-link", { method: "DELETE" });
    setUnlinkLoading(false);
    if (!res.ok) { const d = await res.json(); setLineError(d.error ?? "Failed to unlink."); return; }
    setLineLinked(false);
    setLineWaiting(false);
  }

  async function fetchUsers() {
    setUsersLoading(true);
    setUsersError("");
    const res = await fetch("/api/admin/users");
    if (!res.ok) {
      const body = await res.json();
      setUsersError(body.error ?? "Failed to load users.");
      setUsersLoading(false);
      return;
    }
    const { users: list } = await res.json();
    setUsers(list);
    setUsersLoading(false);
  }

  async function changeRole(userId: string, role: Role) {
    setChangingRole(userId);
    setUsersError("");
    const res = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, role }),
    });
    if (!res.ok) {
      const body = await res.json();
      setUsersError(body.error ?? "Failed to update role.");
    } else {
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, role } : u));
    }
    setChangingRole(null);
  }

  async function saveBudget() {
    const amount = parseFloat(budget);
    if (isNaN(amount) || amount < 0) return;
    setBudgetLoading(true);
    setBudgetSaved(false);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setBudgetLoading(false); return; }
    await supabase.from("profiles").upsert({ id: user.id, monthly_budget: amount });
    setBudgetLoading(false);
    setBudgetSaved(true);
    setTimeout(() => setBudgetSaved(false), 2000);
  }

  async function fetchCategories() {
    setCatLoading(true);
    const { data } = await supabase.from("categories").select("id, name, type").order("name");
    setCategories((data as Category[]) ?? []);
    setCatLoading(false);
  }

  async function fetchCategoryRules() {
    setRulesLoading(true);
    setRulesError("");
    const res = await fetch("/api/category-rules");
    if (!res.ok) { setRulesError("Failed to load rules."); setRulesLoading(false); return; }
    const { rules: list } = await res.json();
    setRules(list);
    setRulesLoading(false);
  }

  async function addCategoryRule() {
    const keyword = newRuleKeyword.trim();
    const category = newRuleCategory.trim();
    if (!keyword || !category) return;
    setAddingRule(true);
    setRulesError("");
    const res = await fetch("/api/category-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword, category, source_type: ruleTab }),
    });
    if (!res.ok) {
      const body = await res.json();
      setRulesError(body.error ?? "Failed to add rule.");
      setAddingRule(false);
      return;
    }
    const { rule } = await res.json();
    setRules(prev => [...prev, rule].sort((a, b) => a.keyword.localeCompare(b.keyword)));
    setNewRuleKeyword("");
    setNewRuleCategory("");
    setAddingRule(false);
  }

  async function deleteCategoryRule(id: string) {
    setDeletingRuleId(id);
    setRulesError("");
    const res = await fetch(`/api/category-rules/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json();
      setRulesError(body.error ?? "Failed to delete rule.");
      setDeletingRuleId(null);
      return;
    }
    setRules(prev => prev.filter(r => r.id !== id));
    setDeletingRuleId(null);
  }

  async function fetchSubscriptions() {
    setSubsLoading(true);
    setSubsError("");
    const res = await fetch("/api/subscriptions");
    if (!res.ok) { setSubsError("Failed to load subscriptions."); setSubsLoading(false); return; }
    const { subscriptions: list } = await res.json();
    setSubscriptions(list);
    setSubsLoading(false);
  }

  async function addSubscription() {
    const name = newSubName.trim();
    const amount = parseFloat(newSubAmount);
    const billingDay = parseInt(newSubDay, 10);
    const category = newSubCategory;
    if (!name || !isFinite(amount) || amount <= 0 || !category) return;
    setAddingSub(true);
    setSubsError("");
    const res = await fetch("/api/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, amount, billing_day: billingDay, category, payment_method: newSubPaymentMethod }),
    });
    if (!res.ok) {
      const body = await res.json();
      setSubsError(body.error ?? "Failed to add subscription.");
      setAddingSub(false);
      return;
    }
    const { subscription } = await res.json();
    setSubscriptions(prev => [...prev, subscription].sort((a, b) => a.billing_day - b.billing_day));
    setNewSubName("");
    setNewSubAmount("");
    setNewSubDay("1");
    setNewSubCategory("");
    setNewSubPaymentMethod("Cash");
    setAddingSub(false);
  }

  async function saveSubEdit(id: string) {
    const name = editSubName.trim();
    const amount = parseFloat(editSubAmount);
    const billingDay = parseInt(editSubDay, 10);
    const category = editSubCategory;
    if (!name || !isFinite(amount) || amount <= 0 || !category) return;
    setSubsError("");
    const current = subscriptions.find(s => s.id === id);
    const res = await fetch(`/api/subscriptions/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name, amount, billing_day: billingDay, category,
        payment_method: editSubPaymentMethod, active: current?.active ?? true,
      }),
    });
    if (!res.ok) {
      const body = await res.json();
      setSubsError(body.error ?? "Failed to update subscription.");
      return;
    }
    const { subscription } = await res.json();
    setSubscriptions(prev => prev.map(s => s.id === id ? subscription : s).sort((a, b) => a.billing_day - b.billing_day));
    setEditingSubId(null);
  }

  async function toggleSubActive(sub: Subscription) {
    setTogglingSubId(sub.id);
    setSubsError("");
    const res = await fetch(`/api/subscriptions/${sub.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: sub.name, amount: sub.amount, billing_day: sub.billing_day,
        category: sub.category, payment_method: sub.payment_method, active: !sub.active,
      }),
    });
    if (!res.ok) {
      const body = await res.json();
      setSubsError(body.error ?? "Failed to update subscription.");
      setTogglingSubId(null);
      return;
    }
    const { subscription } = await res.json();
    setSubscriptions(prev => prev.map(s => s.id === sub.id ? subscription : s));
    setTogglingSubId(null);
  }

  async function deleteSubscription(id: string) {
    setDeletingSubId(id);
    setSubsError("");
    const res = await fetch(`/api/subscriptions/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json();
      setSubsError(body.error ?? "Failed to delete subscription.");
      setDeletingSubId(null);
      return;
    }
    setSubscriptions(prev => prev.filter(s => s.id !== id));
    setDeletingSubId(null);
  }

  async function addCategory(type: CatType) {
    const name = (type === "income" ? newIncomeCatName : newExpenseCatName).trim();
    if (!name) return;
    const dup = categories.find(c => c.type === type && c.name.toLowerCase() === name.toLowerCase());
    if (dup) { setCatError(`"${dup.name}" already exists.`); return; }
    setAddingCat(true);
    setCatError("");
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setAddingCat(false); return; }
    const { data, error: err } = await supabase
      .from("categories")
      .insert({ name, user_id: user.id, type })
      .select("id, name, type")
      .single();
    if (err) { setCatError(err.message); setAddingCat(false); return; }
    setCategories(prev =>
      [...prev, data as Category].sort((a, b) => a.name.localeCompare(b.name))
    );
    if (type === "income") setNewIncomeCatName(""); else setNewExpenseCatName("");
    setAddingCat(false);
  }

  async function saveEdit(id: string) {
    const name = editName.trim();
    if (!name) return;
    const dup = categories.find(c => c.id !== id && c.type === editType && c.name.toLowerCase() === name.toLowerCase());
    if (dup) { setCatError(`"${dup.name}" already exists.`); return; }
    setCatError("");
    const { error: err } = await supabase.from("categories").update({ name, type: editType }).eq("id", id);
    if (err) { setCatError(err.message); return; }
    setCategories(prev =>
      prev.map(c => c.id === id ? { ...c, name, type: editType } : c)
        .sort((a, b) => a.name.localeCompare(b.name))
    );
    setEditingId(null);
    setEditName("");
  }

  async function deleteCategory(id: string) {
    setDeletingId(id);
    setCatError("");
    const { error: err } = await supabase.from("categories").delete().eq("id", id);
    if (err) { setCatError(err.message); setDeletingId(null); return; }
    setCategories(prev => prev.filter(c => c.id !== id));
    setDeletingId(null);
  }

  async function fetchLineResponses() {
    setLineRespLoading(true);
    setLineRespError("");
    const res = await fetch("/api/admin/line-responses");
    if (!res.ok) {
      const body = await res.json();
      setLineRespError(body.error ?? "Failed to load responses.");
      setLineRespLoading(false);
      return;
    }
    const { responses } = await res.json();
    setLineResponses(responses);
    setLineRespLoading(false);
  }

  async function addLineResponse() {
    const cat = newRespCategory.trim();
    const txt = newRespText.trim();
    if (!cat || !txt) return;
    setAddingResp(true);
    setLineRespError("");
    const res = await fetch("/api/admin/line-responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: cat, response_text: txt, type: newRespType }),
    });
    if (!res.ok) {
      const body = await res.json();
      setLineRespError(body.error ?? "Failed to add response.");
      setAddingResp(false);
      return;
    }
    const { response } = await res.json();
    setLineResponses(prev => [...prev, response].sort((a, b) => a.category.localeCompare(b.category)));
    setNewRespCategory("");
    setNewRespText("");
    setAddingResp(false);
  }

  async function saveLineRespEdit(id: string) {
    const cat = editRespCategory.trim();
    const txt = editRespText.trim();
    if (!cat || !txt) return;
    setLineRespError("");
    const res = await fetch("/api/admin/line-responses", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, category: cat, response_text: txt, type: editRespType }),
    });
    if (!res.ok) {
      const body = await res.json();
      setLineRespError(body.error ?? "Failed to update response.");
      return;
    }
    setLineResponses(prev =>
      prev.map(r => r.id === id ? { ...r, category: cat, response_text: txt, type: editRespType } : r)
        .sort((a, b) => a.category.localeCompare(b.category))
    );
    setEditingRespId(null);
  }

  function toggleRespCategory(category: string) {
    setExpandedRespCats(prev => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category); else next.add(category);
      return next;
    });
  }

  async function deleteLineResponse(id: string) {
    setDeletingRespId(id);
    setLineRespError("");
    const res = await fetch(`/api/admin/line-responses?id=${id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json();
      setLineRespError(body.error ?? "Failed to delete response.");
      setDeletingRespId(null);
      return;
    }
    setLineResponses(prev => prev.filter(r => r.id !== id));
    setDeletingRespId(null);
  }

  async function fetchHelpMessage() {
    setHelpMessageLoading(true);
    setHelpMessageError("");
    const res = await fetch("/api/admin/bot-settings?key=help_message");
    if (!res.ok) {
      const body = await res.json();
      setHelpMessageError(body.error ?? "Failed to load help message.");
      setHelpMessageLoading(false);
      return;
    }
    const { setting } = await res.json();
    setHelpMessage(setting.value);
    setHelpMessageLoading(false);
  }

  async function saveHelpMessage() {
    const value = helpMessage.trim();
    if (!value) return;
    setHelpMessageSaving(true);
    setHelpMessageError("");
    setHelpMessageSaved(false);
    const res = await fetch("/api/admin/bot-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "help_message", value }),
    });
    if (!res.ok) {
      const body = await res.json();
      setHelpMessageError(body.error ?? "Failed to save help message.");
      setHelpMessageSaving(false);
      return;
    }
    setHelpMessageSaving(false);
    setHelpMessageSaved(true);
    setTimeout(() => setHelpMessageSaved(false), 2000);
  }

  const roleBadge = (role: Role) => (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-extrabold"
      style={
        role === "admin"
          ? { background: "linear-gradient(135deg, #ec4899, #8b5cf6)", color: "#fff" }
          : { background: "#f3e8ff", color: "#7c3aed" }
      }
    >
      {role === "admin" ? <Shield size={10} /> : <User size={10} />}
      {role}
    </span>
  );

  const renderCategorySection = (
    type: CatType,
    label: string,
    addValue: string,
    setAddValue: (v: string) => void,
    isOpen: boolean,
    onToggle: () => void
  ) => {
    const list = categories.filter(c => c.type === type);
    const gradient = type === "income" ? "linear-gradient(135deg, #10b981, #059669)" : "linear-gradient(135deg, #ec4899, #8b5cf6)";

    return (
      <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
        <button onClick={onToggle} className="w-full flex items-center justify-between p-5 text-left">
          <div>
            <h2 className="text-sm font-black mb-1" style={{ color: "#1f2937" }}>
              {label} <span className="font-semibold" style={{ color: "#9ca3af" }}>({list.length})</span>
            </h2>
            <p className="text-xs font-semibold" style={{ color: "#9ca3af" }}>
              Customize your {type} categories
            </p>
          </div>
          <ChevronDown
            size={16}
            className="flex-shrink-0"
            style={{
              color: "#9ca3af",
              transform: isOpen ? "none" : "rotate(-90deg)",
              transition: "transform 0.15s",
            }}
          />
        </button>

        {isOpen && (
        <div className="px-5 pb-5">
        {/* Add new */}
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            placeholder="New category name…"
            value={addValue}
            onChange={e => setAddValue(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addCategory(type)}
            className="flex-1 rounded-xl px-3 py-2.5 text-sm font-semibold outline-none"
            style={{ border: "2px solid #f3e8ff", color: "#374151" }}
          />
          <button
            onClick={() => addCategory(type)}
            disabled={addingCat || !addValue.trim()}
            className="px-4 py-2.5 rounded-xl text-sm font-extrabold text-white flex items-center gap-1.5"
            style={{
              background: gradient,
              opacity: addingCat || !addValue.trim() ? 0.5 : 1,
            }}
          >
            {addingCat
              ? <Loader2 size={14} className="animate-spin" />
              : <><Plus size={14} /> Add</>
            }
          </button>
        </div>

        {catLoading ? (
          <div className="flex items-center justify-center py-6">
            <span className="loading loading-spinner loading-md" style={{ color: "#a78bfa" }} />
          </div>
        ) : list.length === 0 ? (
          <p className="text-xs font-semibold text-center py-4" style={{ color: "#9ca3af" }}>
            No {type} categories yet. Add one above.
          </p>
        ) : (
          <div className="space-y-2">
            {list.map(cat => (
              <div
                key={cat.id}
                className="flex items-center gap-2 rounded-xl px-3 py-2.5"
                style={{ background: "#fafafa", border: "1px solid #f3e8ff" }}
              >
                {editingId === cat.id ? (
                  <>
                    <select
                      value={editType}
                      onChange={e => setEditType(e.target.value as CatType)}
                      className="rounded-lg px-2 py-1.5 text-xs font-extrabold outline-none appearance-none flex-shrink-0"
                      style={{ border: "2px solid #f3e8ff", color: editType === "income" ? "#059669" : "#dc2626" }}
                    >
                      <option value="expense">Expense</option>
                      <option value="income">Income</option>
                    </select>
                    <input
                      autoFocus
                      type="text"
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter") saveEdit(cat.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      className="flex-1 text-sm font-semibold bg-transparent outline-none"
                      style={{ color: "#374151" }}
                    />
                    <button onClick={() => saveEdit(cat.id)} className="p-1 rounded-lg" style={{ color: "#10b981" }}>
                      <Check size={14} />
                    </button>
                    <button onClick={() => setEditingId(null)} className="p-1 rounded-lg" style={{ color: "#9ca3af" }}>
                      <X size={14} />
                    </button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 text-sm font-semibold" style={{ color: "#374151" }}>
                      {cat.name}
                    </span>
                    <button
                      onClick={() => { setEditingId(cat.id); setEditName(cat.name); setEditType(cat.type); setCatError(""); }}
                      className="p-1 rounded-lg"
                      style={{ color: "#7c3aed" }}
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={() => { if (window.confirm(`Delete category "${cat.name}"?`)) deleteCategory(cat.id); }}
                      disabled={deletingId === cat.id}
                      className="p-1 rounded-lg"
                      style={{ color: "#ef4444" }}
                    >
                      {deletingId === cat.id
                        ? <Loader2 size={13} className="animate-spin" />
                        : <Trash2 size={13} />
                      }
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
        </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      <div
        className="sticky top-0 z-10 bg-white px-5 py-4 flex items-center justify-between"
        style={{ borderBottom: "1px solid #f3e8ff" }}
      >
        <h1 className="text-lg font-black" style={{ color: "#1f2937" }}>Settings ⚙️</h1>
        {roleBadge(userRole)}
      </div>

      <PullToRefresh onRefresh={refreshAll} className="flex-1 overflow-y-auto p-5 space-y-5">

        {/* Admin: User Management */}
        {userRole === "admin" && (
          <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
            <button onClick={() => setUserMgmtOpen(o => !o)} className="w-full flex items-center justify-between p-5 text-left">
              <div>
                <h2 className="text-sm font-black mb-1" style={{ color: "#1f2937" }}>User Management</h2>
                <p className="text-xs font-semibold" style={{ color: "#9ca3af" }}>
                  Manage roles for all accounts
                </p>
              </div>
              <ChevronDown
                size={16}
                className="flex-shrink-0"
                style={{ color: "#9ca3af", transform: userMgmtOpen ? "none" : "rotate(-90deg)", transition: "transform 0.15s" }}
              />
            </button>
            {userMgmtOpen && (
            <div className="px-5 pb-5">

            {usersError && (
              <p
                className="text-xs font-semibold px-3 py-2 rounded-xl mb-3"
                style={{ background: "#fef2f2", color: "#ef4444" }}
              >
                {usersError}
              </p>
            )}

            {usersLoading ? (
              <div className="flex items-center justify-center py-6">
                <span className="loading loading-spinner loading-md" style={{ color: "#a78bfa" }} />
              </div>
            ) : (
              <div className="space-y-2">
                {users.map(u => (
                  <div
                    key={u.id}
                    className="flex items-center gap-3 rounded-xl px-3 py-3"
                    style={{ background: "#fafafa", border: "1px solid #f3e8ff" }}
                  >
                    {/* Avatar placeholder */}
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-extrabold flex-shrink-0 text-white"
                      style={{ background: "linear-gradient(135deg, #ec4899, #8b5cf6)" }}
                    >
                      {(u.full_name?.[0] ?? u.email?.[0] ?? "?").toUpperCase()}
                    </div>

                    {/* Name + email */}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-extrabold truncate" style={{ color: "#374151" }}>
                        {u.full_name}
                        {u.id === currentUserId && (
                          <span className="ml-1.5 text-xs font-bold" style={{ color: "#9ca3af" }}>(you)</span>
                        )}
                      </p>
                      <p className="text-xs font-semibold truncate" style={{ color: "#9ca3af" }}>
                        {u.email}
                      </p>
                    </div>

                    {/* Role selector */}
                    {u.id === currentUserId ? (
                      roleBadge(u.role as Role)
                    ) : (
                      <div className="relative flex-shrink-0">
                        {changingRole === u.id ? (
                          <Loader2 size={14} className="animate-spin" style={{ color: "#a78bfa" }} />
                        ) : (
                          <select
                            value={u.role}
                            onChange={e => changeRole(u.id, e.target.value as Role)}
                            className="text-xs font-extrabold rounded-lg px-2 py-1 cursor-pointer outline-none appearance-none pr-5"
                            style={{
                              border: "2px solid #f3e8ff",
                              color: u.role === "admin" ? "#7c3aed" : "#6b7280",
                              fontFamily: "Nunito",
                              background: u.role === "admin" ? "#faf5ff" : "#f9fafb",
                            }}
                          >
                            <option value="user">user</option>
                            <option value="admin">admin</option>
                          </select>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            </div>
            )}
          </div>
        )}

        {/* Admin: LINE Bot Personality */}
        {userRole === "admin" && (
          <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
            <button onClick={() => setPersonalityOpen(o => !o)} className="w-full flex items-center justify-between p-5 text-left">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <MessageSquare size={15} style={{ color: "#06c755" }} />
                  <h2 className="text-sm font-black" style={{ color: "#1f2937" }}>LINE Bot Personality</h2>
                </div>
                <p className="text-xs font-semibold" style={{ color: "#9ca3af" }}>
                  Sarcastic replies sent after each transaction. Category is matched against the transaction category (e.g. <code className="font-bold">coffee</code>, <code className="font-bold">food</code>). Use <code className="font-bold">general</code> as fallback.
                </p>
              </div>
              <ChevronDown
                size={16}
                className="flex-shrink-0"
                style={{ color: "#9ca3af", transform: personalityOpen ? "none" : "rotate(-90deg)", transition: "transform 0.15s" }}
              />
            </button>
            {personalityOpen && (
            <div className="px-5 pb-5">

            {/* Add form — single compact row */}
            <div className="flex gap-1.5 mb-3">
              <select
                value={newRespType}
                onChange={e => setNewRespType(e.target.value as ResponseType)}
                className="w-[4.5rem] rounded-xl px-1.5 py-2 text-xs font-extrabold outline-none flex-shrink-0 appearance-none"
                style={{ border: "2px solid #f3e8ff", color: newRespType === "income" ? "#059669" : "#dc2626" }}
              >
                <option value="expense">Exp.</option>
                <option value="income">Inc.</option>
              </select>
              <input
                type="text"
                placeholder="Category…"
                value={newRespCategory}
                onChange={e => setNewRespCategory(e.target.value)}
                className="w-24 rounded-xl px-2 py-2 text-xs font-semibold outline-none flex-shrink-0"
                style={{ border: "2px solid #f3e8ff", color: "#374151" }}
              />
              <input
                type="text"
                placeholder="Response message…"
                value={newRespText}
                onChange={e => setNewRespText(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addLineResponse()}
                className="flex-1 rounded-xl px-2 py-2 text-xs font-semibold outline-none min-w-0"
                style={{ border: "2px solid #f3e8ff", color: "#374151" }}
              />
              <button
                onClick={addLineResponse}
                disabled={addingResp || !newRespCategory.trim() || !newRespText.trim()}
                className="px-2.5 py-2 rounded-xl text-xs font-extrabold text-white flex items-center gap-1 flex-shrink-0"
                style={{
                  background: "linear-gradient(135deg, #06c755, #00b248)",
                  opacity: addingResp || !newRespCategory.trim() || !newRespText.trim() ? 0.5 : 1,
                }}
              >
                {addingResp ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              </button>
            </div>

            {lineRespError && (
              <p className="text-xs font-semibold px-3 py-2 rounded-xl mb-3" style={{ background: "#fef2f2", color: "#ef4444" }}>
                {lineRespError}
              </p>
            )}

            {!lineRespLoading && lineResponses.length > 0 && (
              <div className="mb-3">
                <select
                  value={respCategoryFilter}
                  onChange={e => setRespCategoryFilter(e.target.value)}
                  className="w-full rounded-xl px-3 py-2 text-xs font-semibold outline-none cursor-pointer"
                  style={{ border: "2px solid #f3e8ff", color: respCategoryFilter ? "#374151" : "#9ca3af", fontFamily: "Nunito" }}
                >
                  <option value="">Filter by category… (all)</option>
                  {Array.from(new Set(lineResponses.map(r => r.category))).sort().map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
            )}

            {lineRespLoading ? (
              <div className="flex items-center justify-center py-6">
                <span className="loading loading-spinner loading-md" style={{ color: "#a78bfa" }} />
              </div>
            ) : lineResponses.length === 0 ? (
              <p className="text-xs font-semibold text-center py-4" style={{ color: "#9ca3af" }}>
                No responses yet. Add one above.
              </p>
            ) : (
              (() => {
                const filtered = respCategoryFilter
                  ? lineResponses.filter(r => r.category === respCategoryFilter)
                  : lineResponses;

                if (filtered.length === 0) {
                  return (
                    <p className="text-xs font-semibold text-center py-4" style={{ color: "#9ca3af" }}>
                      No responses in this category.
                    </p>
                  );
                }

                const renderTypeGroup = (type: ResponseType, label: string, color: string) => {
                  const typeItems = filtered.filter(r => r.type === type);
                  const catByLower = new Map(
                    categories.filter(c => c.type === type).map(c => [c.name.toLowerCase(), c.name])
                  );
                  const grouped = typeItems.reduce<Record<string, LineResponse[]>>((acc, r) => {
                    const canonical = r.category.toLowerCase() === "general" ? "general" : catByLower.get(r.category.toLowerCase()) ?? "Other";
                    (acc[canonical] ??= []).push(r);
                    return acc;
                  }, {});
                  const catNames = Object.keys(grouped).sort();

                  return (
                    <div>
                      <h3 className="text-xs font-extrabold mb-2" style={{ color }}>{label} ({catNames.length})</h3>
                      {catNames.length === 0 ? (
                        <p className="text-xs font-semibold text-center py-3" style={{ color: "#9ca3af" }}>
                          No {type} responses.
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {catNames.map(catName => {
                            const items = grouped[catName];
                            const respKey = `${type}:${catName}`;
                            const isCollapsed = !expandedRespCats.has(respKey);
                            return (
                              <div key={respKey} className="rounded-xl overflow-hidden" style={{ border: "1px solid #f3e8ff" }}>
                                <button
                                  onClick={() => toggleRespCategory(respKey)}
                                  className="w-full flex items-center justify-between px-3 py-2"
                                  style={{ background: "#faf5ff" }}
                                >
                                  <span className="flex items-center gap-1.5 text-xs font-extrabold" style={{ color: "#374151" }}>
                                    {catName}
                                    <span className="font-semibold" style={{ color: "#9ca3af" }}>({items.length})</span>
                                  </span>
                                  <ChevronDown
                                    size={14}
                                    style={{
                                      color: "#9ca3af",
                                      transform: isCollapsed ? "rotate(-90deg)" : "none",
                                      transition: "transform 0.15s",
                                    }}
                                  />
                                </button>

                                {!isCollapsed && (
                            <div className="p-2 space-y-2" style={{ background: "#fff" }}>
                              {items.map(r => (
                                <div
                                  key={r.id}
                                  className="rounded-xl px-3 py-2.5"
                                  style={{ background: "#fafafa", border: "1px solid #f3e8ff" }}
                                >
                                  {editingRespId === r.id ? (
                                    <div className="flex gap-2">
                                      <select
                                        value={editRespType}
                                        onChange={e => setEditRespType(e.target.value as ResponseType)}
                                        className="w-20 rounded-lg px-1.5 py-1.5 text-xs font-extrabold outline-none flex-shrink-0 appearance-none"
                                        style={{ border: "2px solid #f3e8ff", color: editRespType === "income" ? "#059669" : "#dc2626" }}
                                      >
                                        <option value="expense">Exp.</option>
                                        <option value="income">Inc.</option>
                                      </select>
                                      <input
                                        autoFocus
                                        type="text"
                                        value={editRespCategory}
                                        onChange={e => setEditRespCategory(e.target.value)}
                                        className="w-24 rounded-lg px-2 py-1.5 text-xs font-semibold outline-none flex-shrink-0"
                                        style={{ border: "2px solid #f3e8ff", color: "#374151" }}
                                      />
                                      <input
                                        type="text"
                                        value={editRespText}
                                        onChange={e => setEditRespText(e.target.value)}
                                        onKeyDown={e => {
                                          if (e.key === "Enter") saveLineRespEdit(r.id);
                                          if (e.key === "Escape") setEditingRespId(null);
                                        }}
                                        className="flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold outline-none min-w-0"
                                        style={{ border: "2px solid #f3e8ff", color: "#374151" }}
                                      />
                                      <button onClick={() => saveLineRespEdit(r.id)} className="p-1 rounded-lg flex-shrink-0" style={{ color: "#10b981" }}>
                                        <Check size={14} />
                                      </button>
                                      <button onClick={() => setEditingRespId(null)} className="p-1 rounded-lg flex-shrink-0" style={{ color: "#9ca3af" }}>
                                        <X size={14} />
                                      </button>
                                    </div>
                                  ) : (
                                    <div className="flex items-start gap-2">
                                      <span
                                        className="text-xs font-extrabold px-2 py-0.5 rounded-full flex-shrink-0 mt-0.5"
                                        style={
                                          r.type === "income"
                                            ? { background: "#ecfdf5", color: "#059669", border: "1px solid #a7f3d0" }
                                            : { background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca" }
                                        }
                                      >
                                        {r.type}
                                      </span>
                                      <span className="flex-1 text-xs font-semibold leading-relaxed" style={{ color: "#374151" }}>
                                        {r.response_text}
                                      </span>
                                      <button
                                        onClick={() => { setEditingRespId(r.id); setEditRespCategory(r.category); setEditRespText(r.response_text); setEditRespType(r.type); }}
                                        className="p-1 rounded-lg flex-shrink-0"
                                        style={{ color: "#7c3aed" }}
                                      >
                                        <Pencil size={13} />
                                      </button>
                                      <button
                                        onClick={() => { if (window.confirm(`Delete this ${r.type} response?\n\n"${r.response_text}"`)) deleteLineResponse(r.id); }}
                                        disabled={deletingRespId === r.id}
                                        className="p-1 rounded-lg flex-shrink-0"
                                        style={{ color: "#ef4444" }}
                                      >
                                        {deletingRespId === r.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                                      </button>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                };

                return (
                  <div className="space-y-4">
                    {renderTypeGroup("expense", "💸 Expense", "#dc2626")}
                    {renderTypeGroup("income", "💰 Income", "#059669")}
                  </div>
                );
              })()
            )}
            </div>
            )}
          </div>
        )}

        {/* Admin: Bot Help Message */}
        {userRole === "admin" && (
          <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
            <button onClick={() => setHelpMessageOpen(o => !o)} className="w-full flex items-center justify-between p-5 text-left">
              <div className="flex items-center gap-2">
                <MessageSquare size={15} style={{ color: "#06c755" }} />
                <div>
                  <h2 className="text-sm font-black" style={{ color: "#1f2937" }}>Bot Help Message</h2>
                  <p className="text-xs font-semibold mt-0.5" style={{ color: "#9ca3af" }}>
                    Sent when a user types <code className="font-bold">help</code> or <code className="font-bold">ช่วยด้วย</code>
                  </p>
                </div>
              </div>
              <ChevronDown
                size={16}
                className="flex-shrink-0"
                style={{ color: "#9ca3af", transform: helpMessageOpen ? "none" : "rotate(-90deg)", transition: "transform 0.15s" }}
              />
            </button>

            {helpMessageOpen && (
            <div className="px-5 pb-5">
              {helpMessageError && (
                <p className="text-xs font-semibold px-3 py-2 rounded-xl mb-3" style={{ background: "#fef2f2", color: "#ef4444" }}>
                  {helpMessageError}
                </p>
              )}

              {helpMessageLoading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 size={20} className="animate-spin" style={{ color: "#a78bfa" }} />
                </div>
              ) : (
                <div className="space-y-3">
                  <textarea
                    value={helpMessage}
                    onChange={e => setHelpMessage(e.target.value)}
                    rows={10}
                    className="w-full rounded-xl px-3 py-2.5 text-xs font-semibold outline-none resize-y"
                    style={{ border: "2px solid #f3e8ff", color: "#374151", fontFamily: "Nunito" }}
                  />
                  <button
                    onClick={saveHelpMessage}
                    disabled={helpMessageSaving || !helpMessage.trim()}
                    className="w-full py-2.5 rounded-xl text-sm font-extrabold text-white flex items-center justify-center gap-2"
                    style={{
                      background: helpMessageSaved
                        ? "linear-gradient(135deg, #10b981, #059669)"
                        : "linear-gradient(135deg, #06c755, #00b248)",
                      opacity: helpMessageSaving || !helpMessage.trim() ? 0.6 : 1,
                    }}
                  >
                    {helpMessageSaving
                      ? <Loader2 size={14} className="animate-spin" />
                      : helpMessageSaved ? "Saved ✓" : "Save"
                    }
                  </button>
                </div>
              )}
            </div>
            )}
          </div>
        )}

        {/* Monthly Budget */}
        <div className="bg-white rounded-2xl p-5" style={{ boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
          <h2 className="text-sm font-black mb-1" style={{ color: "#1f2937" }}>Monthly Budget</h2>
          <p className="text-xs font-semibold mb-4" style={{ color: "#9ca3af" }}>
            Set your monthly spending limit
          </p>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <span
                className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-extrabold"
                style={{ color: "#9ca3af" }}
              >
                ฿
              </span>
              <input
                type="number"
                min="0"
                step="100"
                placeholder="35000"
                value={budget}
                onChange={e => setBudget(e.target.value)}
                onKeyDown={e => e.key === "Enter" && saveBudget()}
                className="w-full rounded-xl pl-7 pr-3 py-2.5 text-sm font-semibold outline-none"
                style={{ border: "2px solid #f3e8ff", color: "#374151" }}
              />
            </div>
            <button
              onClick={saveBudget}
              disabled={budgetLoading}
              className="px-5 py-2.5 rounded-xl text-sm font-extrabold text-white flex items-center gap-2 transition-all"
              style={{
                background: budgetSaved
                  ? "linear-gradient(135deg, #10b981, #059669)"
                  : "linear-gradient(135deg, #ec4899, #8b5cf6)",
                boxShadow: "0 3px 12px rgba(236,72,153,0.3)",
                opacity: budgetLoading ? 0.7 : 1,
              }}
            >
              {budgetLoading
                ? <Loader2 size={14} className="animate-spin" />
                : budgetSaved ? "Saved ✓" : "Save"
              }
            </button>
          </div>
        </div>

        {/* Categories */}
        {catError && (
          <p
            className="text-xs font-semibold px-3 py-2 rounded-xl"
            style={{ background: "#fef2f2", color: "#ef4444" }}
          >
            {catError}
          </p>
        )}
        {renderCategorySection("expense", "Expense Categories 💳", newExpenseCatName, setNewExpenseCatName, expenseCatOpen, () => setExpenseCatOpen(o => !o))}
        {renderCategorySection("income", "Income Categories 💰", newIncomeCatName, setNewIncomeCatName, incomeCatOpen, () => setIncomeCatOpen(o => !o))}

        {/* Auto-Categorization Rules */}
        <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
          <button onClick={() => setRulesOpen(o => !o)} className="w-full flex items-center justify-between p-5 text-left">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Zap size={15} style={{ color: "#f59e0b" }} />
                <h2 className="text-sm font-black" style={{ color: "#1f2937" }}>Auto-Categorization Rules</h2>
              </div>
              <p className="text-xs font-semibold" style={{ color: "#9ca3af" }}>
                When a receipt (OCR) or LINE chat message contains a keyword, the category is assigned automatically.
              </p>
            </div>
            <ChevronDown
              size={16}
              className="flex-shrink-0"
              style={{ color: "#9ca3af", transform: rulesOpen ? "none" : "rotate(-90deg)", transition: "transform 0.15s" }}
            />
          </button>
          {rulesOpen && (
          <div className="px-5 pb-5">

          <div className="flex gap-1 mb-4 p-1 rounded-xl w-fit" style={{ background: "#f9fafb" }}>
            {(["ocr", "chat"] as RuleSourceType[]).map(tab => (
              <button
                key={tab}
                onClick={() => setRuleTab(tab)}
                className="px-4 py-1.5 rounded-lg text-xs font-extrabold transition-all"
                style={
                  ruleTab === tab
                    ? { background: "linear-gradient(135deg, #f59e0b, #d97706)", color: "#fff" }
                    : { color: "#9ca3af" }
                }
              >
                {tab === "ocr" ? "OCR Rules" : "Chat Rules"}
              </button>
            ))}
          </div>

          <div className="flex gap-2 mb-4">
            <input
              type="text"
              placeholder="keyword (e.g. ข้าว)"
              value={newRuleKeyword}
              onChange={e => setNewRuleKeyword(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addCategoryRule()}
              className="flex-1 rounded-xl px-3 py-2 text-xs font-semibold outline-none"
              style={{ border: "2px solid #f3e8ff", color: "#374151" }}
            />
            <select
              value={newRuleCategory}
              onChange={e => setNewRuleCategory(e.target.value)}
              className="w-36 rounded-xl px-2 py-2 text-xs font-semibold outline-none cursor-pointer"
              style={{ border: "2px solid #f3e8ff", color: newRuleCategory ? "#374151" : "#9ca3af", fontFamily: "Nunito" }}
            >
              <option value="">Category…</option>
              {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
            <button
              onClick={addCategoryRule}
              disabled={addingRule || !newRuleKeyword.trim() || !newRuleCategory}
              className="px-3 py-2 rounded-xl text-xs font-extrabold text-white flex items-center gap-1 flex-shrink-0"
              style={{
                background: "linear-gradient(135deg, #f59e0b, #d97706)",
                opacity: addingRule || !newRuleKeyword.trim() || !newRuleCategory ? 0.5 : 1,
              }}
            >
              {addingRule ? <Loader2 size={12} className="animate-spin" /> : <><Plus size={12} /> Add</>}
            </button>
          </div>

          {rulesError && (
            <p className="text-xs font-semibold px-3 py-2 rounded-xl mb-3" style={{ background: "#fef2f2", color: "#ef4444" }}>
              {rulesError}
            </p>
          )}

          {rulesLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 size={20} className="animate-spin" style={{ color: "#a78bfa" }} />
            </div>
          ) : rules.filter(r => r.source_type === ruleTab).length === 0 ? (
            <p className="text-xs font-semibold text-center py-4" style={{ color: "#9ca3af" }}>
              No {ruleTab === "ocr" ? "OCR" : "chat"} rules yet. Add one above to start auto-categorizing.
            </p>
          ) : (
            <div className="space-y-2">
              {rules.filter(r => r.source_type === ruleTab).map(rule => (
                <div
                  key={rule.id}
                  className="flex items-center gap-2 rounded-xl px-3 py-2.5"
                  style={{ background: "#fafafa", border: "1px solid #f3e8ff" }}
                >
                  <span
                    className="text-xs font-extrabold px-2 py-0.5 rounded-full flex-shrink-0"
                    style={{ background: "#fef3c7", color: "#d97706", border: "1px solid #fde68a" }}
                  >
                    {rule.keyword}
                  </span>
                  <span className="text-xs font-semibold flex-shrink-0" style={{ color: "#9ca3af" }}>→</span>
                  <span className="flex-1 text-xs font-bold" style={{ color: "#374151" }}>{rule.category}</span>
                  <button
                    onClick={() => { if (window.confirm(`Delete rule "${rule.keyword} → ${rule.category}"?`)) deleteCategoryRule(rule.id); }}
                    disabled={deletingRuleId === rule.id}
                    className="p-1 rounded-lg flex-shrink-0"
                    style={{ color: "#ef4444" }}
                  >
                    {deletingRuleId === rule.id
                      ? <Loader2 size={13} className="animate-spin" />
                      : <Trash2 size={13} />}
                  </button>
                </div>
              ))}
            </div>
          )}
          </div>
          )}
        </div>

        {/* Subscriptions (recurring monthly expenses) */}
        <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
          <button onClick={() => setSubsOpen(o => !o)} className="w-full flex items-center justify-between p-5 text-left">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Repeat size={15} style={{ color: "#8b5cf6" }} />
                <h2 className="text-sm font-black" style={{ color: "#1f2937" }}>
                  Subscriptions <span className="font-semibold" style={{ color: "#9ca3af" }}>({subscriptions.length})</span>
                </h2>
              </div>
              <p className="text-xs font-semibold" style={{ color: "#9ca3af" }}>
                Recurring monthly expenses — auto-added on their billing day each month.
              </p>
            </div>
            <ChevronDown
              size={16}
              className="flex-shrink-0"
              style={{ color: "#9ca3af", transform: subsOpen ? "none" : "rotate(-90deg)", transition: "transform 0.15s" }}
            />
          </button>
          {subsOpen && (
          <div className="px-5 pb-5">

          {/* Add new */}
          <div className="space-y-2 mb-4">
            <input
              type="text"
              placeholder="Name (e.g. Netflix)"
              value={newSubName}
              onChange={e => setNewSubName(e.target.value)}
              className="w-full rounded-xl px-3 py-2.5 text-sm font-semibold outline-none"
              style={{ border: "2px solid #f3e8ff", color: "#374151" }}
            />
            <div className="flex gap-2">
              <input
                type="number"
                step="0.01"
                min="0.01"
                placeholder="Amount (฿)"
                value={newSubAmount}
                onChange={e => setNewSubAmount(e.target.value)}
                className="flex-1 rounded-xl px-3 py-2.5 text-sm font-semibold outline-none"
                style={{ border: "2px solid #f3e8ff", color: "#374151" }}
              />
              <select
                value={newSubDay}
                onChange={e => setNewSubDay(e.target.value)}
                className="w-24 rounded-xl px-2 py-2.5 text-sm font-semibold outline-none cursor-pointer"
                style={{ border: "2px solid #f3e8ff", color: "#374151", fontFamily: "Nunito" }}
              >
                {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                  <option key={d} value={d}>Day {d}</option>
                ))}
              </select>
            </div>
            <select
              value={newSubCategory}
              onChange={e => setNewSubCategory(e.target.value)}
              className="w-full rounded-xl px-3 py-2.5 text-sm font-semibold outline-none cursor-pointer"
              style={{ border: "2px solid #f3e8ff", color: newSubCategory ? "#374151" : "#9ca3af", fontFamily: "Nunito" }}
            >
              <option value="">Category…</option>
              {categories.filter(c => c.type === "expense").map(c => (
                <option key={c.id} value={c.name}>{c.name}</option>
              ))}
            </select>
            <div className="flex rounded-xl overflow-hidden" style={{ border: "2px solid #f3e8ff" }}>
              {(["Cash", "Credit Card"] as SubPaymentMethod[]).map(pm => (
                <button
                  key={pm}
                  type="button"
                  onClick={() => setNewSubPaymentMethod(pm)}
                  className="flex-1 py-2 text-xs font-extrabold transition-all"
                  style={
                    newSubPaymentMethod === pm
                      ? { background: "linear-gradient(135deg, #ec4899, #8b5cf6)", color: "#fff" }
                      : { color: "#7c3aed", background: "transparent" }
                  }
                >
                  {pm === "Cash" ? "💵 Cash" : "💳 Credit Card"}
                </button>
              ))}
            </div>
            <button
              onClick={addSubscription}
              disabled={addingSub || !newSubName.trim() || !newSubAmount || !newSubCategory}
              className="w-full py-2.5 rounded-xl text-sm font-extrabold text-white flex items-center justify-center gap-1.5"
              style={{
                background: "linear-gradient(135deg, #ec4899, #8b5cf6)",
                opacity: addingSub || !newSubName.trim() || !newSubAmount || !newSubCategory ? 0.5 : 1,
              }}
            >
              {addingSub ? <Loader2 size={14} className="animate-spin" /> : <><Plus size={14} /> Add Subscription</>}
            </button>
          </div>

          {subsError && (
            <p className="text-xs font-semibold px-3 py-2 rounded-xl mb-3" style={{ background: "#fef2f2", color: "#ef4444" }}>
              {subsError}
            </p>
          )}

          {subsLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 size={20} className="animate-spin" style={{ color: "#a78bfa" }} />
            </div>
          ) : subscriptions.length === 0 ? (
            <p className="text-xs font-semibold text-center py-4" style={{ color: "#9ca3af" }}>
              No subscriptions yet. Add one above to auto-track a recurring expense.
            </p>
          ) : (
            <div className="space-y-2">
              {subscriptions.map(sub => (
                <div
                  key={sub.id}
                  className="rounded-xl px-3 py-2.5"
                  style={{ background: "#fafafa", border: "1px solid #f3e8ff" }}
                >
                  {editingSubId === sub.id ? (
                    <div className="space-y-2">
                      <input
                        autoFocus
                        type="text"
                        value={editSubName}
                        onChange={e => setEditSubName(e.target.value)}
                        className="w-full rounded-lg px-2 py-1.5 text-sm font-semibold outline-none"
                        style={{ border: "2px solid #f3e8ff", color: "#374151" }}
                      />
                      <div className="flex gap-2">
                        <input
                          type="number"
                          step="0.01"
                          min="0.01"
                          value={editSubAmount}
                          onChange={e => setEditSubAmount(e.target.value)}
                          className="flex-1 rounded-lg px-2 py-1.5 text-sm font-semibold outline-none"
                          style={{ border: "2px solid #f3e8ff", color: "#374151" }}
                        />
                        <select
                          value={editSubDay}
                          onChange={e => setEditSubDay(e.target.value)}
                          className="w-20 rounded-lg px-1 py-1.5 text-xs font-semibold outline-none cursor-pointer"
                          style={{ border: "2px solid #f3e8ff", color: "#374151", fontFamily: "Nunito" }}
                        >
                          {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                            <option key={d} value={d}>Day {d}</option>
                          ))}
                        </select>
                      </div>
                      <select
                        value={editSubCategory}
                        onChange={e => setEditSubCategory(e.target.value)}
                        className="w-full rounded-lg px-2 py-1.5 text-xs font-semibold outline-none cursor-pointer"
                        style={{ border: "2px solid #f3e8ff", color: "#374151", fontFamily: "Nunito" }}
                      >
                        {categories.filter(c => c.type === "expense").map(c => (
                          <option key={c.id} value={c.name}>{c.name}</option>
                        ))}
                      </select>
                      <div className="flex rounded-lg overflow-hidden" style={{ border: "2px solid #f3e8ff" }}>
                        {(["Cash", "Credit Card"] as SubPaymentMethod[]).map(pm => (
                          <button
                            key={pm}
                            type="button"
                            onClick={() => setEditSubPaymentMethod(pm)}
                            className="flex-1 py-1.5 text-xs font-extrabold transition-all"
                            style={
                              editSubPaymentMethod === pm
                                ? { background: "linear-gradient(135deg, #ec4899, #8b5cf6)", color: "#fff" }
                                : { color: "#7c3aed", background: "transparent" }
                            }
                          >
                            {pm === "Cash" ? "💵 Cash" : "💳 Card"}
                          </button>
                        ))}
                      </div>
                      <div className="flex justify-end gap-1">
                        <button onClick={() => saveSubEdit(sub.id)} className="p-1.5 rounded-lg" style={{ color: "#10b981" }}>
                          <Check size={14} />
                        </button>
                        <button onClick={() => setEditingSubId(null)} className="p-1.5 rounded-lg" style={{ color: "#9ca3af" }}>
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-extrabold" style={{ color: "#374151" }}>{sub.name}</span>
                          <span
                            className="text-xs font-extrabold px-2 py-0.5 rounded-full flex-shrink-0"
                            style={{ background: "#f3e8ff", color: "#7c3aed" }}
                          >
                            Day {sub.billing_day}
                          </span>
                          <span
                            className="text-xs font-extrabold px-2 py-0.5 rounded-full flex-shrink-0"
                            style={sub.active
                              ? { background: "#f0fdf4", color: "#15803d" }
                              : { background: "#f3f4f6", color: "#9ca3af" }}
                          >
                            {sub.active ? "Active" : "Paused"}
                          </span>
                        </div>
                        <p className="text-xs font-semibold mt-0.5" style={{ color: "#9ca3af" }}>
                          ฿{sub.amount.toFixed(2)} · {sub.category} · {sub.payment_method === "Cash" ? "💵 Cash" : "💳 Credit Card"}
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          setEditingSubId(sub.id);
                          setEditSubName(sub.name);
                          setEditSubAmount(String(sub.amount));
                          setEditSubDay(String(sub.billing_day));
                          setEditSubCategory(sub.category);
                          setEditSubPaymentMethod(sub.payment_method);
                          setSubsError("");
                        }}
                        className="p-1 rounded-lg flex-shrink-0"
                        style={{ color: "#7c3aed" }}
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        onClick={() => toggleSubActive(sub)}
                        disabled={togglingSubId === sub.id}
                        className="p-1 rounded-lg flex-shrink-0"
                        style={{ color: sub.active ? "#d97706" : "#10b981" }}
                      >
                        {togglingSubId === sub.id
                          ? <Loader2 size={13} className="animate-spin" />
                          : sub.active ? <Pause size={13} /> : <Play size={13} />}
                      </button>
                      <button
                        onClick={() => { if (window.confirm(`Delete subscription "${sub.name}"?`)) deleteSubscription(sub.id); }}
                        disabled={deletingSubId === sub.id}
                        className="p-1 rounded-lg flex-shrink-0"
                        style={{ color: "#ef4444" }}
                      >
                        {deletingSubId === sub.id
                          ? <Loader2 size={13} className="animate-spin" />
                          : <Trash2 size={13} />}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          </div>
          )}
        </div>

        {/* Theme Toggle */}
        <div className="bg-white rounded-2xl p-5" style={{ boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
          <ThemeToggle />
        </div>

        {/* LINE Connect */}
        <div className="bg-white rounded-2xl p-5" style={{ boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
          <h2 className="text-sm font-black mb-1" style={{ color: "#1f2937" }}>Connect LINE</h2>
          <p className="text-xs font-semibold mb-4" style={{ color: "#9ca3af" }}>
            Record expenses by sending a message to the LINE bot
          </p>

          {lineError && (
            <p className="text-xs font-semibold px-3 py-2 rounded-xl mb-3" style={{ background: "#fef2f2", color: "#ef4444" }}>
              {lineError}
            </p>
          )}

          {lineLinked ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 rounded-xl px-3 py-2.5" style={{ background: "#f0fdf4", border: "1px solid #bbf7d0" }}>
                <span className="text-base">✓</span>
                <span className="text-xs font-extrabold" style={{ color: "#15803d" }}>LINE account connected</span>
              </div>
              <p className="text-xs font-semibold" style={{ color: "#9ca3af" }}>
                Send messages like <code className="font-bold">500 Food &amp; Dining</code> to the bot to log expenses.
              </p>
              <button
                onClick={unlinkLine}
                disabled={unlinkLoading}
                className="w-full py-2.5 rounded-xl text-sm font-extrabold flex items-center justify-center gap-2"
                style={{ background: "#fef2f2", color: "#ef4444", border: "2px solid #fecaca", opacity: unlinkLoading ? 0.7 : 1 }}
              >
                {unlinkLoading ? <Loader2 size={14} className="animate-spin" /> : "Unlink LINE account"}
              </button>
            </div>
          ) : lineWaiting ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3 rounded-xl px-4 py-3" style={{ background: "#fffbeb", border: "1px solid #fde68a" }}>
                <Loader2 size={16} className="animate-spin flex-shrink-0" style={{ color: "#d97706" }} />
                <div>
                  <p className="text-xs font-extrabold" style={{ color: "#92400e" }}>Waiting for LINE…</p>
                  <p className="text-xs font-semibold mt-0.5" style={{ color: "#b45309" }}>
                    Tap Send in LINE to finish connecting
                  </p>
                </div>
              </div>
              <button
                onClick={() => setLineWaiting(false)}
                className="w-full py-2 rounded-xl text-xs font-extrabold"
                style={{ background: "#f3e8ff", color: "#7c3aed" }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs font-semibold" style={{ color: "#9ca3af" }}>
                Tap the button — LINE will open with everything pre-filled. Just hit Send.
              </p>
              <button
                onClick={connectLine}
                disabled={linkLoading}
                className="w-full py-3 rounded-xl text-sm font-extrabold text-white flex items-center justify-center gap-2"
                style={{
                  background: "linear-gradient(135deg, #06c755, #00b248)",
                  boxShadow: "0 4px 14px rgba(6,199,85,0.4)",
                  opacity: linkLoading ? 0.7 : 1,
                }}
              >
                {linkLoading ? <Loader2 size={14} className="animate-spin" /> : "💬 Connect with LINE"}
              </button>
            </div>
          )}
        </div>

        {/* Sign out */}
        <div className="pb-4">
          <button
            onClick={async () => {
              await supabase.auth.signOut();
              window.location.href = "/login";
            }}
            className="w-full px-6 py-2.5 rounded-xl text-sm font-extrabold"
            style={{ background: "#fef2f2", color: "#ef4444", border: "2px solid #fecaca" }}
          >
            Sign out
          </button>
        </div>
      </PullToRefresh>
    </div>
  );
}
