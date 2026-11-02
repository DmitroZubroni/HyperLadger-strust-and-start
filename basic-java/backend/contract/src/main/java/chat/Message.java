package chat;

/** Сообщение общего чата. */
public class Message {
    public String author;
    public String time;
    public String text;

    public Message() {
    }

    public Message(String author, String time, String text) {
        this.author = author;
        this.time = time;
        this.text = text;
    }
}
