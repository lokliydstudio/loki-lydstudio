package no.lokilyd.crm;

import org.json.JSONObject;

final class TaskItem {
    final String id;
    final String title;
    final String details;
    final String dueDate;
    final String priority;
    final String assignee;
    final String updatedBy;
    final boolean completed;

    TaskItem(JSONObject json) {
        id = json.optString("id");
        title = json.optString("title");
        details = json.optString("details");
        dueDate = json.optString("dueDate");
        priority = json.optString("priority");
        assignee = json.optString("assignee");
        updatedBy = json.optString("updatedBy");
        completed = json.optBoolean("completed");
    }

    String actorName() {
        if (updatedBy.equalsIgnoreCase("leon@lokilyd.no")) return "Leon";
        if (updatedBy.equalsIgnoreCase("charles@lokilyd.no")) return "Charles";
        return "En bruker";
    }
}
